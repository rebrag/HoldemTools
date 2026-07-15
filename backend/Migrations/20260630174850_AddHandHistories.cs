using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GTOLiteAPI.Migrations
{
    /// <inheritdoc />
    public partial class AddHandHistories : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "HandHistories",
                columns: table => new
                {
                    Id = table.Column<int>(type: "int", nullable: false)
                        .Annotation("SqlServer:Identity", "1, 1"),
                    UserId = table.Column<string>(type: "nvarchar(128)", maxLength: 128, nullable: false),
                    RawText = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    SessionId = table.Column<Guid>(type: "uniqueidentifier", nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HandHistories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_HandHistories_BankrollSessions_SessionId",
                        column: x => x.SessionId,
                        principalTable: "BankrollSessions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_HandHistories_SessionId",
                table: "HandHistories",
                column: "SessionId");

            migrationBuilder.CreateIndex(
                name: "IX_HandHistories_UserId",
                table: "HandHistories",
                column: "UserId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "HandHistories");
        }
    }
}
