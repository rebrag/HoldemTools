using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GTOLiteAPI.Migrations
{
    /// <inheritdoc />
    public partial class AddEngineCompareJobSampledCore : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "SampledConfigJson",
                table: "EngineCompareJobs",
                type: "nvarchar(max)",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "SampledResultBlobPath",
                table: "EngineCompareJobs",
                type: "nvarchar(512)",
                maxLength: 512,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "SampledConfigJson",
                table: "EngineCompareJobs");

            migrationBuilder.DropColumn(
                name: "SampledResultBlobPath",
                table: "EngineCompareJobs");
        }
    }
}
