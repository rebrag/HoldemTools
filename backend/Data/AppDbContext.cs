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

        public DbSet<HandHistory> HandHistories { get; set; } = default!;

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

            modelBuilder.Entity<HandHistory>(entity =>
            {
                // Bounded so it can be indexed (SQL Server can't index nvarchar(max)).
                entity.Property(e => e.UserId)
                    .HasMaxLength(128);

                entity.Property(e => e.Title)
                    .HasMaxLength(200);

                // RawText is left as nvarchar(max) so full hand histories fit.
                entity.HasIndex(e => e.UserId);
            });
        }
    }
}
