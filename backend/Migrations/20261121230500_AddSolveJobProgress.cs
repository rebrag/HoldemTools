using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GTOLiteAPI.Migrations
{
    /// <inheritdoc />
    public partial class AddSolveJobProgress : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<double>(
                name: "ProgressExploitablePct",
                table: "SolveJobs",
                type: "float",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "ProgressIteration",
                table: "SolveJobs",
                type: "int",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "ProgressTargetPct",
                table: "SolveJobs",
                type: "float",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ProgressExploitablePct",
                table: "SolveJobs");

            migrationBuilder.DropColumn(
                name: "ProgressIteration",
                table: "SolveJobs");

            migrationBuilder.DropColumn(
                name: "ProgressTargetPct",
                table: "SolveJobs");
        }
    }
}
