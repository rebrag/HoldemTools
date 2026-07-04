// Controllers/HandHistoryController.cs
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using PokerRangeAPI2.Data;
using PokerRangeAPI2.Models;
using PokerRangeAPI2.Services;
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
        // Pass ?sessionId= to return only the hands linked to a given bankroll session.
        [HttpGet]
        public async Task<ActionResult<IEnumerable<HandHistory>>> GetAll(
            [FromQuery] string? userId,
            [FromQuery] Guid? sessionId)
        {
            var uid = CurrentUid();
            if (string.IsNullOrWhiteSpace(uid))
            {
                return Unauthorized();
            }

            var target = (IsAdmin() && !string.IsNullOrWhiteSpace(userId)) ? userId! : uid;

            var query = _db.HandHistories.Where(h => h.UserId == target);

            if (sessionId.HasValue)
            {
                query = query.Where(h => h.SessionId == sessionId.Value);
            }

            var items = await query
                .OrderByDescending(h => h.CreatedAt)
                .ToListAsync();

            return Ok(items);
        }

        // GET /api/handhistory/{id}
        [HttpGet("{id:int}")]
        public async Task<ActionResult<HandHistory>> GetById(int id)
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
                // Id is a database-generated identity; do not set it here.
                UserId = uid, // from the token, never the body
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
        [HttpPut("{id:int}")]
        public async Task<ActionResult<HandHistory>> Update(int id, [FromBody] HandHistoryDto dto)
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

            entity.RawText = dto.RawText;
            entity.SessionId = dto.SessionId;
            entity.UpdatedAt = DateTimeOffset.UtcNow;

            await _db.SaveChangesAsync();
            return Ok(entity);
        }

        // DELETE /api/handhistory/{id}
        [HttpDelete("{id:int}")]
        public async Task<IActionResult> Delete(int id)
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

        public class ShareTokenResponse
        {
            public string Token { get; set; } = default!;
        }

        // POST /api/handhistory/{id}/share
        // Create (or return the existing) public share token for a hand the caller owns.
        // Idempotent: repeat calls for the same hand return the same token.
        [HttpPost("{id:int}/share")]
        public async Task<ActionResult<ShareTokenResponse>> CreateShare(int id)
        {
            var uid = CurrentUid();
            if (string.IsNullOrWhiteSpace(uid))
            {
                return Unauthorized();
            }

            var entity = await _db.HandHistories.FindAsync(id);
            if (entity == null)
            {
                return NotFound();
            }
            if (entity.UserId != uid && !IsAdmin())
            {
                // Owner-only. Contract requires 403 (not 404) here.
                return Forbid();
            }

            if (string.IsNullOrEmpty(entity.ShareToken))
            {
                entity.ShareToken = ShareTokenGenerator.NewToken();
                await _db.SaveChangesAsync();
            }

            return Ok(new ShareTokenResponse { Token = entity.ShareToken });
        }

        // DELETE /api/handhistory/{id}/share
        // Revoke the share token so GET /api/shared/{token} returns 404 afterwards.
        [HttpDelete("{id:int}/share")]
        public async Task<IActionResult> DeleteShare(int id)
        {
            var uid = CurrentUid();
            if (string.IsNullOrWhiteSpace(uid))
            {
                return Unauthorized();
            }

            var entity = await _db.HandHistories.FindAsync(id);
            if (entity == null)
            {
                return NotFound();
            }
            if (entity.UserId != uid && !IsAdmin())
            {
                return Forbid();
            }

            if (!string.IsNullOrEmpty(entity.ShareToken))
            {
                entity.ShareToken = null;
                await _db.SaveChangesAsync();
            }

            return NoContent();
        }
    }
}
