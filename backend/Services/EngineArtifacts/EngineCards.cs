namespace PokerRangeAPI2.Services.EngineArtifacts;

/// <summary>
/// The engine's card and combo conventions, mirrored from
/// engine/docs/artifact-format.md: card code = rank * 4 + suit (rank 0..12 =
/// 2..A, suit 0..3 = c,d,h,s); canonical 1326 combo order = (hi, lo) pairs
/// with hi &gt; lo, sorted by hi descending then lo descending.
/// </summary>
public static class EngineCards
{
    public const int NumCombos = 1326;
    private const string RankChars = "23456789TJQKA";
    private const string SuitChars = "cdhs";

    private static readonly (byte Hi, byte Lo)[] Combos = BuildCombos();

    private static (byte Hi, byte Lo)[] BuildCombos()
    {
        var combos = new (byte, byte)[NumCombos];
        var i = 0;
        for (var hi = 51; hi >= 1; hi--)
            for (var lo = hi - 1; lo >= 0; lo--)
                combos[i++] = ((byte)hi, (byte)lo);
        return combos;
    }

    public static string CardToString(int card) =>
        $"{RankChars[card / 4]}{SuitChars[card % 4]}";

    public static (int Hi, int Lo) ComboCards(int comboIndex) => Combos[comboIndex];

    /// <summary>"AsAh" for a canonical combo index (higher card first).</summary>
    public static string ComboToString(int comboIndex)
    {
        var (hi, lo) = Combos[comboIndex];
        return CardToString(hi) + CardToString(lo);
    }

    /// <summary>"AA" / "AKs" / "T9o" hand class of a canonical combo index.</summary>
    public static string ComboClass(int comboIndex)
    {
        var (hi, lo) = Combos[comboIndex];
        var rankHi = RankChars[hi / 4];
        var rankLo = RankChars[lo / 4];
        if (hi / 4 == lo / 4) return $"{rankHi}{rankLo}";
        var suited = hi % 4 == lo % 4;
        return $"{rankHi}{rankLo}{(suited ? 's' : 'o')}";
    }

    /// <summary>
    /// 169-class grid index (13x13 row-major, rank order A..2 descending,
    /// pairs on the diagonal, suited above, offsuit below) - the rollup
    /// ordering in the artifact.
    /// </summary>
    public static int ClassIndex(int comboIndex)
    {
        var (hi, lo) = Combos[comboIndex];
        var gridHi = 12 - hi / 4;
        var gridLo = 12 - lo / 4;
        if (gridHi == gridLo) return gridHi * 13 + gridHi;
        var suited = hi % 4 == lo % 4;
        return suited ? gridHi * 13 + gridLo : gridLo * 13 + gridHi;
    }

    /// <summary>Class name for a 169-grid index ("AA", "AKs", "T9o").</summary>
    public static string ClassName(int classIndex)
    {
        var i = classIndex / 13;
        var j = classIndex % 13;
        var hi = RankChars[12 - Math.Min(i, j)];
        var lo = RankChars[12 - Math.Max(i, j)];
        if (i == j) return $"{hi}{lo}";
        return $"{hi}{lo}{(i < j ? 's' : 'o')}";
    }
}
