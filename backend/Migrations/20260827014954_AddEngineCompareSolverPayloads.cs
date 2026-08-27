using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GTOLiteAPI.Migrations
{
    /// <inheritdoc />
    public partial class AddEngineCompareSolverPayloads : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "DisableCompare",
                table: "EngineCompareJobs",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "DisableCrossCheck",
                table: "EngineCompareJobs",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "DisablePio",
                table: "EngineCompareJobs",
                type: "bit",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "HtResultBlobPath",
                table: "EngineCompareJobs",
                type: "nvarchar(512)",
                maxLength: 512,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PioResultBlobPath",
                table: "EngineCompareJobs",
                type: "nvarchar(512)",
                maxLength: 512,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DisableCompare",
                table: "EngineCompareJobs");

            migrationBuilder.DropColumn(
                name: "DisableCrossCheck",
                table: "EngineCompareJobs");

            migrationBuilder.DropColumn(
                name: "DisablePio",
                table: "EngineCompareJobs");

            migrationBuilder.DropColumn(
                name: "HtResultBlobPath",
                table: "EngineCompareJobs");

            migrationBuilder.DropColumn(
                name: "PioResultBlobPath",
                table: "EngineCompareJobs");
        }
    }
}
