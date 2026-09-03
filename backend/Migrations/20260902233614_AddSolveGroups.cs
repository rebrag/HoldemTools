using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GTOLiteAPI.Migrations
{
    /// <inheritdoc />
    public partial class AddSolveGroups : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "SolveGroups",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    CreatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAtUtc = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SolveGroups", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "SolveGroupMembers",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    GroupId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    JobId = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    Position = table.Column<int>(type: "int", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SolveGroupMembers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SolveGroupMembers_EngineCompareJobs_JobId",
                        column: x => x.JobId,
                        principalTable: "EngineCompareJobs",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_SolveGroupMembers_SolveGroups_GroupId",
                        column: x => x.GroupId,
                        principalTable: "SolveGroups",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SolveGroupMembers_GroupId",
                table: "SolveGroupMembers",
                column: "GroupId");

            migrationBuilder.CreateIndex(
                name: "IX_SolveGroupMembers_JobId",
                table: "SolveGroupMembers",
                column: "JobId");

            migrationBuilder.CreateIndex(
                name: "IX_SolveGroups_UserId",
                table: "SolveGroups",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SolveGroupMembers");

            migrationBuilder.DropTable(
                name: "SolveGroups");
        }
    }
}
