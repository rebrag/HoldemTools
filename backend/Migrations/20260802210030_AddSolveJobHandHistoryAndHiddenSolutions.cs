using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GTOLiteAPI.Migrations
{
    /// <inheritdoc />
    public partial class AddSolveJobHandHistoryAndHiddenSolutions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "HandHistoryId",
                table: "SolveJobs",
                type: "int",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "HiddenSolutions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: false),
                    Stacks = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    NodeName = table.Column<string>(type: "nvarchar(200)", maxLength: 200, nullable: false),
                    Board = table.Column<string>(type: "nvarchar(12)", maxLength: 12, nullable: false),
                    HiddenAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HiddenSolutions", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SolveJobs_HandHistoryId",
                table: "SolveJobs",
                column: "HandHistoryId");

            migrationBuilder.CreateIndex(
                name: "IX_SolveJobs_ResultStacks_ResultNodeName_Board",
                table: "SolveJobs",
                columns: new[] { "ResultStacks", "ResultNodeName", "Board" });

            migrationBuilder.CreateIndex(
                name: "IX_HiddenSolutions_UserId_Stacks_NodeName_Board",
                table: "HiddenSolutions",
                columns: new[] { "UserId", "Stacks", "NodeName", "Board" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_SolveJobs_HandHistories_HandHistoryId",
                table: "SolveJobs",
                column: "HandHistoryId",
                principalTable: "HandHistories",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_SolveJobs_HandHistories_HandHistoryId",
                table: "SolveJobs");

            migrationBuilder.DropTable(
                name: "HiddenSolutions");

            migrationBuilder.DropIndex(
                name: "IX_SolveJobs_HandHistoryId",
                table: "SolveJobs");

            migrationBuilder.DropIndex(
                name: "IX_SolveJobs_ResultStacks_ResultNodeName_Board",
                table: "SolveJobs");

            migrationBuilder.DropColumn(
                name: "HandHistoryId",
                table: "SolveJobs");
        }
    }
}
