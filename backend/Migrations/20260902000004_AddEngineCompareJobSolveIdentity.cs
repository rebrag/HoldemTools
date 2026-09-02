using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GTOLiteAPI.Migrations
{
    /// <inheritdoc />
    public partial class AddEngineCompareJobSolveIdentity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "Iterations",
                table: "EngineCompareJobs",
                type: "bigint",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SolveId",
                table: "EngineCompareJobs",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SolveKey",
                table: "EngineCompareJobs",
                type: "nvarchar(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_EngineCompareJobs_UserId_SolveId",
                table: "EngineCompareJobs",
                columns: new[] { "UserId", "SolveId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_EngineCompareJobs_UserId_SolveId",
                table: "EngineCompareJobs");

            migrationBuilder.DropColumn(
                name: "Iterations",
                table: "EngineCompareJobs");

            migrationBuilder.DropColumn(
                name: "SolveId",
                table: "EngineCompareJobs");

            migrationBuilder.DropColumn(
                name: "SolveKey",
                table: "EngineCompareJobs");
        }
    }
}
