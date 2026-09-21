using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GTOLiteAPI.Migrations
{
    /// <inheritdoc />
    public partial class AddEngineCompareJobPlan : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PlanJson",
                table: "EngineCompareJobs",
                type: "nvarchar(max)",
                maxLength: 16000,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PlanJson",
                table: "EngineCompareJobs");
        }
    }
}
