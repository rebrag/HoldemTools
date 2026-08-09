using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GTOLiteAPI.Migrations
{
    /// <summary>
    /// One-time data backfill: link each unlinked hand to the bankroll session
    /// whose [Start, End] window contains the hand's CreatedAt, matching the
    /// time-window adoption BankrollController now performs on save. When
    /// windows overlap, the latest-starting session wins. No schema change,
    /// and nothing to undo - Down is intentionally empty (re-running Up is
    /// harmless because it only touches NULL SessionId rows).
    /// </summary>
    public partial class BackfillHandSessionLinks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(@"
UPDATE h
SET h.[SessionId] = match.[Id]
FROM [HandHistories] AS h
CROSS APPLY (
    SELECT TOP 1 s.[Id]
    FROM [BankrollSessions] AS s
    WHERE s.[UserId] = h.[UserId]
      AND s.[Start] IS NOT NULL
      AND s.[End] IS NOT NULL
      AND h.[CreatedAt] >= s.[Start]
      AND h.[CreatedAt] <= s.[End]
    ORDER BY s.[Start] DESC
) AS match
WHERE h.[SessionId] IS NULL;
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {

        }
    }
}
