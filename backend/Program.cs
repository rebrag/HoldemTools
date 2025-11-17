using Microsoft.AspNetCore.Builder;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using PokerRangeAPI2.Data;
using System;

var builder = WebApplication.CreateBuilder(args);

// Controllers & Swagger
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();
builder.Services.AddMemoryCache();

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
app.UseAuthorization();
app.MapControllers();

app.Run();
