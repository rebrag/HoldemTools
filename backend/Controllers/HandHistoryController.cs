// Controllers/HandHistoryController.cs
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading.Tasks;

namespace PokerRangeAPI2.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    [Authorize] // every action here requires a verified Firebase ID token
    public class HandHistoryController : ControllerBase
    {
        private readonly AppDbContext _db;
        private readonly IConfiguration _config;

        public HandHistoryController(AppDbContext db, IConfiguration config)
        {
            _db = db;
            _config = config;
        }

        // Firebase ID tokens carry the uid in both "user_id" and "sub" claims.
        private string? CurrentUid() =>
            User.FindFirst("user_id")?.Value
            ?? User.FindFirst("sub")?.Value
            ?? User.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        private string? CurrentEmail() => User.FindFirst("email")?.Value;

        private bool IsAdmin()
        {
            var adminEmails = _config.GetSection("Admin:Emails").Get<string[]>() ?? Array.Empty<string>();
            var adminUids = _config.GetSection("Admin:Uids").Get<string[]>() ?? Array.Empty<string>();

            var email = CurrentEmail();
            var uid = CurrentUid();

            return (email != null && adminEmails.Contains(email, StringComparer.OrdinalIgnoreCase))
                || (uid != null && adminUids.Contains(uid, StringComparer.Ordinal));
        }

        // GET /api/handhistory
        // Returns the caller's hand histories. An admin may pass ?userId= to view another user's.
        [HttpGet]
        public async Task<ActionResult<IEnumerable<HandHistory>>> GetAll([FromQuery] string? userId)
        {
            var uid = CurrentUid();
            if (string.IsNullOrWhiteSpace(uid))
            {
                return Unauthorized();
            }

            var target = (IsAdmin() && !string.IsNullOrWhiteSpace(userId)) ? userId! : uid;

            var items = await _db.HandHistories
                .Where(h => h.UserId == target)
                .OrderByDescending(h => h.CreatedAt)
                .ToListAsync();

            return Ok(items);
        }

        // GET /api/handhistory/{id}
        [HttpGet("{id:guid}")]
        public async Task<ActionResult<HandHistory>> GetById(Guid id)
        {
            var uid = CurrentUid();
            if (string.IsNullOrWhiteSpace(uid))
            {
                return Unauthorized();
            }

            var item = await _db.HandHistories.FindAsync(id);
            if (item == null || (item.UserId != uid && !IsAdmin()))
            {
                // Return NotFound (not Forbid) so we don't reveal that another user's record exists.
                return NotFound();
            }

            return Ok(item);
        }

        public class HandHistoryDto
        {
            public string? Title { get; set; }
            public string? RawText { get; set; }
            public Guid? SessionId { get; set; }
        }

        // POST /api/handhistory
        [HttpPost]
        public async Task<ActionResult<HandHistory>> Create([FromBody] HandHistoryDto dto)
        {
            var uid = CurrentUid();
            if (string.IsNullOrWhiteSpace(uid))
            {
                return Unauthorized();
            }

            if (dto == null || string.IsNullOrWhiteSpace(dto.RawText))
            {
                return BadRequest("rawText is required.");
            }

            var entity = new HandHistory
            {
                Id = Guid.NewGuid(),
                UserId = uid, // from the token, never the body
                Title = string.IsNullOrWhiteSpace(dto.Title) ? null : dto.Title.Trim(),
                RawText = dto.RawText,
                SessionId = dto.SessionId,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = null
            };

            _db.HandHistories.Add(entity);
            await _db.SaveChangesAsync();

            return Ok(entity);
        }

        // PUT /api/handhistory/{id}
        [HttpPut("{id:guid}")]
        public async Task<ActionResult<HandHistory>> Update(Guid id, [FromBody] HandHistoryDto dto)
        {
            var uid = CurrentUid();
            if (string.IsNullOrWhiteSpace(uid))
            {
                return Unauthorized();
            }

            if (dto == null || string.IsNullOrWhiteSpace(dto.RawText))
            {
                return BadRequest("rawText is required.");
            }

            var entity = await _db.HandHistories.FindAsync(id);
            if (entity == null || (entity.UserId != uid && !IsAdmin()))
            {
                return NotFound();
            }

            entity.Title = string.IsNullOrWhiteSpace(dto.Title) ? null : dto.Title.Trim();
            entity.RawText = dto.RawText;
            entity.SessionId = dto.SessionId;
            entity.UpdatedAt = DateTimeOffset.UtcNow;

            await _db.SaveChangesAsync();
            return Ok(entity);
        }

        // DELETE /api/handhistory/{id}
        [HttpDelete("{id:guid}")]
        public async Task<IActionResult> Delete(Guid id)
        {
            var uid = CurrentUid();
            if (string.IsNullOrWhiteSpace(uid))
            {
                return Unauthorized();
            }

            var entity = await _db.HandHistories.FindAsync(id);
            if (entity == null || (entity.UserId != uid && !IsAdmin()))
            {
                return NotFound();
            }

            _db.HandHistories.Remove(entity);
            await _db.SaveChangesAsync();
            return NoContent();
        }
    }
}
