namespace PokerRangeAPI2.Services.EngineArtifacts;

/// <summary>
/// Byte-range access to one engine artifact (.hta). The reader only ever
/// asks for ranges, so a local file today and an ADLS Gen2 Range-GET source
/// later are interchangeable without touching <see cref="EngineArtifactReader"/>.
/// </summary>
public interface IArtifactByteSource
{
    long Length { get; }
    Task<ReadOnlyMemory<byte>> ReadRangeAsync(long offset, int length, CancellationToken ct = default);
}

/// <summary>Local-file implementation (the only one in this pass).</summary>
public sealed class FileArtifactByteSource : IArtifactByteSource, IDisposable
{
    private readonly FileStream _stream;

    public FileArtifactByteSource(string path)
    {
        _stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
    }

    public long Length => _stream.Length;

    public async Task<ReadOnlyMemory<byte>> ReadRangeAsync(long offset, int length, CancellationToken ct = default)
    {
        var buffer = new byte[length];
        _stream.Seek(offset, SeekOrigin.Begin);
        await _stream.ReadExactlyAsync(buffer, 0, length, ct);
        return buffer;
    }

    public void Dispose() => _stream.Dispose();
}
