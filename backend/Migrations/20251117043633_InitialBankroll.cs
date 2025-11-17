using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace GTOLiteAPI.Migrations
{
    /// <inheritdoc />
    public partial class InitialBankroll : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BankrollSessions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uniqueidentifier", nullable: false),
                    UserId = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Type = table.Column<string>(type: "nvarchar(max)", nullable: false),
                    Start = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    End = table.Column<DateTimeOffset>(type: "datetimeoffset", nullable: true),
                    Hours = table.Column<double>(type: "float", nullable: true),
                    Location = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Game = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    Blinds = table.Column<string>(type: "nvarchar(max)", nullable: true),
                    BuyIn = table.Column<decimal>(type: "decimal(18,2)", nullable: true),
                    CashOut = table.Column<decimal>(type: "decimal(18,2)", nullable: true),
                    Profit = table.Column<decimal>(type: "decimal(18,2)", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BankrollSessions", x => x.Id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BankrollSessions");
        }
    }
}
