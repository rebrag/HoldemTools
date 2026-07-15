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

                // RawText is left as nvarchar(max) so full hand histories fit.
                entity.HasIndex(e => e.UserId);
                entity.HasIndex(e => e.SessionId);

                // Public share token: bounded so it can be indexed, and uniquely
                // indexed for fast token -> hand lookups on the public GET route.
                // Filtered so many unshared hands (ShareToken == null) don't collide.
                entity.Property(e => e.ShareToken)
                    .HasMaxLength(64);
                entity.HasIndex(e => e.ShareToken)
                    .IsUnique()
                    .HasFilter("[ShareToken] IS NOT NULL");

                // Optional FK to a bankroll session. Deleting a session unlinks its
                // hands (sets SessionId null) rather than deleting the hands.
                entity.HasOne(e => e.Session)
                    .WithMany()
                    .HasForeignKey(e => e.SessionId)
                    .OnDelete(DeleteBehavior.SetNull);
            });
        }
    }
}
