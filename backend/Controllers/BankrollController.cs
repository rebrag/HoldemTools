// Controllers/BankrollController.cs
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace PokerRangeAPI2.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class BankrollController : ControllerBase
    {
        private readonly AppDbContext _db;

        public BankrollController(AppDbContext db)
        {
            _db = db;
        }

        // --- NEW WARMUP ENDPOINT ---
        // Matches GET /api/warmup/sql from Homepage.tsx
        [HttpGet("/api/warmup/sql")]
        public async Task<IActionResult> WarmupSql()
        {
            try
            {
                // Executes a lightweight query to wake up the database and prime EF Core
                await _db.Database.ExecuteSqlRawAsync("SELECT 1");
                return Ok(new { warmed = true, timestamp = DateTime.UtcNow });
            }
            catch (Exception)
            {
                // Homepage.tsx expects a best-effort result; 
                // We return a 500 but the frontend .catch() will ignore it.
                return StatusCode(500, "Warmup failed");
            }
        }

        // GET /api/bankroll?userId=UID
        [HttpGet]
        public async Task<ActionResult<IEnumerable<BankrollSession>>> GetSessions([FromQuery] string userId)
        {
            if (string.IsNullOrWhiteSpace(userId))
            {
                return BadRequest("userId is required.");
            }

            var sessions = await _db.BankrollSessions
                .Where(s => s.UserId == userId)
                .OrderBy(s => s.Start)
                .ToListAsync();

            return Ok(sessions);
        }

        // GET /api/bankroll/ping
        [HttpGet("ping")]
        public ActionResult<string> Ping()
        {
            return Ok("bankroll ok");
        }

        // GET /api/bankroll/{id}
        [HttpGet("{id:guid}")]
        public async Task<ActionResult<BankrollSession>> GetSessionById(Guid id)
        {
            var session = await _db.BankrollSessions.FindAsync(id);
            if (session == null)
            {
                return NotFound();
            }

            return Ok(session);
        }

        // DTO used for both create & update
        public class CreateBankrollSessionDto
        {
            public string UserId { get; set; } = default!;
            public string? Type { get; set; }

            public DateTimeOffset? Start { get; set; }
            public DateTimeOffset? End { get; set; }

            public double? Hours { get; set; }

            public string? Location { get; set; }
            public string? Game { get; set; }
            public string? Blinds { get; set; }

            public decimal? BuyIn { get; set; }
            public decimal? CashOut { get; set; }

            public decimal? Profit { get; set; }
        }

        // POST /api/bankroll
        [HttpPost]
        public async Task<ActionResult<BankrollSession>> CreateSession([FromBody] CreateBankrollSessionDto dto)
        {
            if (dto == null)
            {
                return BadRequest("Body is required.");
            }

            if (string.IsNullOrWhiteSpace(dto.UserId))
            {
                return BadRequest("UserId is required.");
            }

            decimal? profit = dto.Profit;
            if (!profit.HasValue && dto.BuyIn.HasValue && dto.CashOut.HasValue)
            {
                profit = dto.CashOut.Value - dto.BuyIn.Value;
            }

            if (!profit.HasValue)
            {
                return BadRequest("Profit is required, or both BuyIn and CashOut must be provided.");
            }

            var entity = new BankrollSession
            {
                Id = Guid.NewGuid(),
                UserId = dto.UserId,
                Type = string.IsNullOrWhiteSpace(dto.Type) ? "Cash" : dto.Type.Trim(),
                Start = dto.Start,
                End = dto.End,
                Hours = dto.Hours,
                Location = string.IsNullOrWhiteSpace(dto.Location) ? null : dto.Location.Trim(),
                Game = string.IsNullOrWhiteSpace(dto.Game) ? null : dto.Game.Trim(),
                Blinds = string.IsNullOrWhiteSpace(dto.Blinds) ? null : dto.Blinds.Trim(),
                BuyIn = dto.BuyIn,
                CashOut = dto.CashOut,
                Profit = profit.Value
            };

            _db.BankrollSessions.Add(entity);
            await _db.SaveChangesAsync();

            return Ok(entity);
        }

        // PUT /api/bankroll/{id}
        [HttpPut("{id:guid}")]
        public async Task<ActionResult<BankrollSession>> UpdateSession(
            Guid id,
            [FromBody] CreateBankrollSessionDto dto)
        {
            if (dto == null)
            {
                return BadRequest("Body is required.");
            }

            var entity = await _db.BankrollSessions.FindAsync(id);
            if (entity == null)
            {
                return NotFound();
            }

            if (!string.IsNullOrWhiteSpace(dto.UserId) && dto.UserId != entity.UserId)
            {
                return BadRequest("UserId mismatch for this session.");
            }

            if (!string.IsNullOrWhiteSpace(dto.Type))
            {
                entity.Type = dto.Type.Trim();
            }

            entity.Start = dto.Start;
            entity.End = dto.End;
            entity.Hours = dto.Hours;
            entity.Location = string.IsNullOrWhiteSpace(dto.Location) ? null : dto.Location.Trim();
            entity.Game = string.IsNullOrWhiteSpace(dto.Game) ? null : dto.Game.Trim();
            entity.Blinds = string.IsNullOrWhiteSpace(dto.Blinds) ? null : dto.Blinds.Trim();
            entity.BuyIn = dto.BuyIn;
            entity.CashOut = dto.CashOut;

            decimal? profit = dto.Profit;
            if (!profit.HasValue && dto.BuyIn.HasValue && dto.CashOut.HasValue)
            {
                profit = dto.CashOut.Value - dto.BuyIn.Value;
            }

            if (profit.HasValue)
            {
                entity.Profit = profit.Value;
            }

            await _db.SaveChangesAsync();
            return Ok(entity);
        }

        // DELETE /api/bankroll/{id}
        [HttpDelete("{id:guid}")]
        public async Task<IActionResult> DeleteSession(Guid id)
        {
            var session = await _db.BankrollSessions.FindAsync(id);
            if (session == null)
            {
                return NotFound();
            }

            _db.BankrollSessions.Remove(session);
            await _db.SaveChangesAsync();
            return NoContent();
        }
    }
}