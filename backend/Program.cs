using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Builder;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
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

// === EF Core: AppDbContext ===
builder.Services.AddDbContext<AppDbContext>(options =>
{
    var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
    options.UseSqlServer(connectionString);
});

// === CORS ===
const string CorsPolicy = "AllowWebClients";
builder.Services.AddCors(opts =>
{
    opts.AddPolicy(CorsPolicy, policy =>
    {
        policy
            .WithOrigins(
                "https://www.holdemtools.com",
                "https://holdemtools.com",
                "http://localhost:5173",
                "https://localhost:5173"
            )
            .SetIsOriginAllowed(origin =>
            {
                try { return new Uri(origin).Host.EndsWith("vercel.app", StringComparison.OrdinalIgnoreCase); }
                catch { return false; }
            })
            .AllowAnyHeader()
            .AllowAnyMethod();
        // .AllowCredentials();
    });
});

var app = builder.Build();

// CORS
app.UseCors(CorsPolicy);

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
