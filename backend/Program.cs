using System;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

var builder = WebApplication.CreateBuilder(args);

// Controllers & Swagger
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// === CORS ===
// If you do NOT use cookies/auth, keep AllowCredentials() OFF.
// If you DO use cookies/auth, set .AllowCredentials() and add credentials on the client.
const string CorsPolicy = "AllowWebClients";
builder.Services.AddCors(opts =>
{
    opts.AddPolicy(CorsPolicy, policy =>
    {
        policy
            // Explicit production origins:
            .WithOrigins(
                "https://www.holdemtools.com",
                "https://holdemtools.com",
                "http://localhost:5173",
                "https://localhost:5173"
            )
            // If you want to allow ALL *.vercel.app preview deploys:
            .SetIsOriginAllowed(origin =>
            {
                // Keep the explicit list above; this adds a controlled rule for vercel previews.
                // NOTE: Avoid this if you don't need previews.
                try { return new Uri(origin).Host.EndsWith("vercel.app", StringComparison.OrdinalIgnoreCase); }
                catch { return false; }
            })
            .AllowAnyHeader()
            .AllowAnyMethod();
        // .AllowCredentials(); // <-- ONLY if you actually use cookies/auth
    });
});

var app = builder.Build();

// CORS must be before auth/endpoints; call it ONCE with the right policy name
app.UseCors(CorsPolicy);

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseHttpsRedirection();
app.UseAuthorization();
app.MapControllers();

app.Run();
