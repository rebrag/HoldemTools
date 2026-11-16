using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GTOLiteAPI.Migrations
{
    /// <inheritdoc />
    public partial class AddSolveJobSolver : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "HasEngineTree",
                table: "SolveJobs",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "Solver",
                table: "SolveJobs",
                type: "nvarchar(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "pio");

            migrationBuilder.CreateIndex(
                name: "IX_SolveJobs_Solver_Status_Priority_CreatedAtUtc",
                table: "SolveJobs",
                columns: new[] { "Solver", "Status", "Priority", "CreatedAtUtc" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_SolveJobs_Solver_Status_Priority_CreatedAtUtc",
                table: "SolveJobs");

            migrationBuilder.DropColumn(
                name: "HasEngineTree",
                table: "SolveJobs");

            migrationBuilder.DropColumn(
                name: "Solver",
                table: "SolveJobs");
        }
    }
}
