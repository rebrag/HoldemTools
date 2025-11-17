// Data/AppDbContext.cs
using Microsoft.EntityFrameworkCore;
using PokerRangeAPI2.Models;

namespace PokerRangeAPI2.Data
{
    public class AppDbContext : DbContext
    {
        public AppDbContext(DbContextOptions<AppDbContext> options)
            : base(options)
        {
        }

        public DbSet<BankrollSession> BankrollSessions { get; set; } = default!;

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            modelBuilder.Entity<BankrollSession>(entity =>
            {
                entity.Property(e => e.BuyIn)
                    .HasPrecision(18, 2);

                entity.Property(e => e.CashOut)
                    .HasPrecision(18, 2);

                entity.Property(e => e.Profit)
                    .HasPrecision(18, 2);
            });
        }
    }
}
