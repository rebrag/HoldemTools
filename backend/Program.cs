using Azure.Storage.Queues;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using PokerRangeAPI2.Data;
using System;

var builder = WebApplication.CreateBuilder(args);

// Controllers & Swagger
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddMemoryCache();

// Gzip/brotli for JSON responses (solution docs are large and repetitive).
// Pre-gzipped street bundles set their own Content-Encoding and are skipped
// by this middleware automatically.
builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
});

// === Firebase ID-token authentication (used by [Authorize] controllers only) ===
// Endpoints without [Authorize] stay anonymous, so existing controllers are unaffected.
//
// This API does NOT use the Firebase Admin SDK, so the usual
// FIREBASE_AUTH_EMULATOR_HOST environment variable has no effect here - running
// against the Auth emulator needs the explicit branch below.
var useFirebaseEmulator =
    Environment.GetEnvironmentVariable("USE_FIREBASE_EMULATOR") == "true";
var firebaseProjectId =
    Environment.GetEnvironmentVariable("FIREBASE_PROJECT_ID")
    ?? builder.Configuration["Firebase:ProjectId"]
    ?? "gto-lite";

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        if (useFirebaseEmulator)
        {
            // ⚠️ EMULATOR ONLY - this path ACCEPTS UNSIGNED TOKENS.
            //
            // The Firebase Auth emulator mints ID tokens with `alg: none` and an
            // empty signature, so signature validation cannot succeed. Issuer,
            // audience and expiry are still checked, and the project id is a
            // `demo-` one that can never correspond to a real Firebase project,
            // so a token minted here is worthless against production.
            //
            // Reached only when USE_FIREBASE_EMULATOR=true, which is set solely
            // by the Claude Code cloud-session environment. Never set it on a
            // deployed instance.
            //
            // Authority is deliberately left unset: assigning it makes the
            // handler fetch OIDC discovery metadata from Google on first
            // request, which is exactly what the offline emulator avoids.
            options.RequireHttpsMetadata = false;
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidIssuer = $"https://securetoken.google.com/{firebaseProjectId}",
                ValidateAudience = true,
                ValidAudience = firebaseProjectId,
                ValidateLifetime = true,
                ValidateIssuerSigningKey = false,
                RequireSignedTokens = false,
                // Must return a JsonWebToken, not a JwtSecurityToken: .NET 8's
                // JwtBearer uses JsonWebTokenHandler by default, and it rejects
                // any other SecurityToken shape with "The signature is invalid".
                SignatureValidator = (token, _) => new JsonWebToken(token)
            };
        }
        else
        {
            options.Authority = $"https://securetoken.google.com/{firebaseProjectId}";
            options.TokenValidationParameters = new TokenValidationParameters
            {
                ValidateIssuer = true,
                ValidIssuer = $"https://securetoken.google.com/{firebaseProjectId}",
                ValidateAudience = true,
                ValidAudience = firebaseProjectId,
                ValidateLifetime = true
            };
        }
    });

// === Storage queue: noderequest push notifications for the solver watcher ===
// One singleton client; the queue itself is created once at startup below, so
// the user-facing POST handler never pays a create round trip.
builder.Services.AddSingleton(sp =>
{
    var config = sp.GetRequiredService<Microsoft.Extensions.Configuration.IConfiguration>();
    var conn = config["AzureStorage:ConnectionString"];
    var queueName = config["AzureStorage:NodeRequestQueueName"] ?? "noderequests";
    if (string.IsNullOrWhiteSpace(conn))
        throw new InvalidOperationException("AzureStorage:ConnectionString is missing from configuration.");
    return new QueueClient(conn, queueName);
});

// === Player photo blob storage ===
// Behind an interface so PlayersController stays constructible in the
// EF-InMemory test suite without Azure configuration.
builder.Services.AddSingleton<PokerRangeAPI2.Services.IPlayerPhotoStore,
    PokerRangeAPI2.Services.AdlsPlayerPhotoStore>();

// === Engine local solutions (dev only) ===
// No-op unless Engine:LocalSolutionsDir is configured; never set it on a
// deployed instance. See Services/EngineArtifacts/EngineLocalSolutions.cs.
builder.Services.AddSingleton<PokerRangeAPI2.Services.EngineArtifacts.EngineLocalSolutions>();

// === EF Core: AppDbContext ===
builder.Services.AddDbContext<AppDbContext>(options =>
{
    var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
    options.UseSqlServer(connectionString);
});

// === CORS ===
//
// Every allowed origin is decided by the single predicate below. Splitting the
// rules between WithOrigins(...) and SetIsOriginAllowed(...) does NOT combine
// them: WithOrigins installs a predicate that consults its list, and a later
// SetIsOriginAllowed overwrites it outright, silently dropping the whole list.
//
// Vercel preview deployments get a fresh subdomain per push, so they can only
// be matched by suffix. The leading dot matters - EndsWith("vercel.app") would
// also accept an attacker-registered "evilvercel.app".
//
// Keep this the only CORS layer. Populating the App Service "Allowed Origins"
// blade in Azure makes the platform answer preflights instead, which shadows
// this policy entirely and cannot express the wildcard below.
const string CorsPolicy = "AllowWebClients";

var allowedOrigins = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
{
    "https://www.holdemtools.com",
    "https://holdemtools.com",
};

// Vite dev servers. Each git worktree needs its own port (see the VITE_DEV_PORT
// note in frontend/CLAUDE.md), so allow the small range parallel checkouts use
// rather than editing this list per worktree.
for (var port = 5173; port <= 5179; port++)
{
    allowedOrigins.Add($"http://localhost:{port}");
    allowedOrigins.Add($"https://localhost:{port}");
}

static bool IsVercelPreview(string origin) =>
    Uri.TryCreate(origin, UriKind.Absolute, out var uri)
    && uri.Scheme == Uri.UriSchemeHttps
    && uri.Host.EndsWith(".vercel.app", StringComparison.OrdinalIgnoreCase);

builder.Services.AddCors(opts =>
{
    opts.AddPolicy(CorsPolicy, policy =>
    {
        policy
            .SetIsOriginAllowed(origin =>
                allowedOrigins.Contains(origin) || IsVercelPreview(origin))
            .AllowAnyHeader()
            .AllowAnyMethod();
        // .AllowCredentials();
    });
});

var app = builder.Build();

// Ensure the noderequest queue exists. Not fatal on failure: enqueues then
// fail per request (logged) and the watcher's reconcile listing still
// discovers the blobs, so push degrades to slow rather than broken.
try
{
    app.Services.GetRequiredService<QueueClient>().CreateIfNotExists();
}
catch (Exception ex)
{
    app.Logger.LogWarning(ex, "Noderequest queue create failed; push notifications degraded.");
}

// CORS
app.UseCors(CorsPolicy);

// Compress after CORS (preflights untouched), before anything writes a body.
app.UseResponseCompression();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

app.Run();
