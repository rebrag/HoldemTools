using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GTOLiteAPI.Migrations
{
    /// <inheritdoc />
    public partial class AddSavedTrees : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TreeFolders",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    ParentId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TreeFolders", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TreeFolders_TreeFolders_ParentId",
                        column: x => x.ParentId,
                        principalTable: "TreeFolders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "SavedTrees",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: false),
                    Name = table.Column<string>(type: "nvarchar(100)", maxLength: 100, nullable: false),
                    FolderId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    Config = table.Column<string>(type: "nvarchar(max)", maxLength: 16000, nullable: false),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SavedTrees", x => x.Id);
                    table.ForeignKey(
                        name: "FK_SavedTrees_TreeFolders_FolderId",
                        column: x => x.FolderId,
                        principalTable: "TreeFolders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_SavedTrees_FolderId",
                table: "SavedTrees",
                column: "FolderId");

            migrationBuilder.CreateIndex(
                name: "IX_SavedTrees_UserId",
                table: "SavedTrees",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_TreeFolders_ParentId",
                table: "TreeFolders",
                column: "ParentId");

            migrationBuilder.CreateIndex(
                name: "IX_TreeFolders_UserId",
                table: "TreeFolders",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "SavedTrees");

            migrationBuilder.DropTable(
                name: "TreeFolders");
        }
    }
}
