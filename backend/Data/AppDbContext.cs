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

        public DbSet<SolveJob> SolveJobs { get; set; } = default!;

        public DbSet<HiddenSolution> HiddenSolutions { get; set; } = default!;

        public DbSet<Player> Players { get; set; } = default!;

        public DbSet<EngineCompareJob> EngineCompareJobs { get; set; } = default!;

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

            modelBuilder.Entity<SolveJob>(entity =>
            {
                // Every string bounded (SQL Server can't index nvarchar(max));
                // only Error is wide, and it is never indexed.
                entity.Property(e => e.UserId).HasMaxLength(128);
                entity.Property(e => e.Type).HasMaxLength(16);
                entity.Property(e => e.BlobPath).HasMaxLength(512);
                entity.Property(e => e.Folder).HasMaxLength(200);
                entity.Property(e => e.LineKey).HasMaxLength(200);
                entity.Property(e => e.ActingPos).HasMaxLength(16);
                entity.Property(e => e.Board).HasMaxLength(12);
                entity.Property(e => e.Status).HasMaxLength(16);
                entity.Property(e => e.Error).HasMaxLength(2000);
                entity.Property(e => e.WatcherId).HasMaxLength(64);
                entity.Property(e => e.ResultStacks).HasMaxLength(200);
                entity.Property(e => e.ResultNodeName).HasMaxLength(200);

                entity.HasIndex(e => e.UserId);

                // Drives the claim ordering (Queued, priority desc, oldest
                // first) and the queue-position counts.
                entity.HasIndex(e => new { e.Status, e.Priority, e.CreatedAtUtc });

                // Optional FK to the recorded hand this solve came from.
                // Deleting the hand unlinks the job (the solved board stays in
                // the library) rather than deleting solve history.
                entity.HasOne(e => e.HandHistory)
                    .WithMany()
                    .HasForeignKey(e => e.HandHistoryId)
                    .OnDelete(DeleteBehavior.SetNull);

                // Resolves an index entry back to its job: the library overlay
                // looks boards up by their manifest coordinates.
                entity.HasIndex(e => new { e.ResultStacks, e.ResultNodeName, e.Board });
            });

            modelBuilder.Entity<EngineCompareJob>(entity =>
            {
                // Every indexable string bounded (SQL Server can't index
                // nvarchar(max)); ConfigJson and Error are wide, never indexed.
                entity.Property(e => e.UserId).HasMaxLength(128);
                entity.Property(e => e.Mode).HasMaxLength(16);
                entity.Property(e => e.Board).HasMaxLength(12);
                entity.Property(e => e.Status).HasMaxLength(16);
                entity.Property(e => e.Error).HasMaxLength(2000);
                entity.Property(e => e.WatcherId).HasMaxLength(64);
                entity.Property(e => e.ResultBlobPath).HasMaxLength(512);
                entity.Property(e => e.ResultStacks).HasMaxLength(200);
                entity.Property(e => e.ResultNodeName).HasMaxLength(200);

                entity.HasIndex(e => e.UserId);
                // Drives the claim ordering (Queued, oldest first).
                entity.HasIndex(e => new { e.Status, e.CreatedAtUtc });
            });

            modelBuilder.Entity<Player>(entity =>
            {
                // Every indexable string bounded (SQL Server can't index nvarchar(max)).
                entity.Property(e => e.UserId).HasMaxLength(128);
                entity.Property(e => e.Name).HasMaxLength(100);
                entity.Property(e => e.Notes).HasMaxLength(4000);
                entity.Property(e => e.PhotoPath).HasMaxLength(512);
                entity.Property(e => e.PhotoContentType).HasMaxLength(64);

                // The only query shape is "all my players".
                entity.HasIndex(e => e.UserId);

                // Deliberately NO unique index on (UserId, Name): duplicate names
                // are a feature - identity is the row, never the name.
            });

            modelBuilder.Entity<HiddenSolution>(entity =>
            {
                entity.Property(e => e.UserId).HasMaxLength(128);
                entity.Property(e => e.Stacks).HasMaxLength(200);
                entity.Property(e => e.NodeName).HasMaxLength(200);
                entity.Property(e => e.Board).HasMaxLength(12);

                // One row per (viewer, board): hiding twice is a no-op, and the
                // library overlay probes this set on every read.
                entity.HasIndex(e => new { e.UserId, e.Stacks, e.NodeName, e.Board })
                    .IsUnique();
            });
        }
    }
}
