import csv, sys, random, collections
random.seed(20261029)
THEMES = """mateIn1 mateIn2 mateIn3 mateIn4 mateIn5 mate endgame middlegame opening rookEndgame pawnEndgame queenEndgame bishopEndgame knightEndgame queenRookEndgame
fork pin skewer discoveredAttack doubleCheck sacrifice deflection attraction interference clearance xRayAttack zugzwang quietMove defensiveMove promotion underPromotion
enPassant castling hangingPiece trappedPiece kingsideAttack queensideAttack backRankMate smotheredMate anastasiaMate arabianMate bodenMate doubleBishopMate dovetailMate hookMate
exposedKing advancedPawn capturingDefender attackingF2F7 intermezzo short long veryLong oneMove crushing advantage equality master""".split()
QUOTA = int(sys.argv[1])
BUCKETS = list(range(400, 3300, 100))
per_bucket = max(1, QUOTA // len(BUCKETS))
res = collections.defaultdict(list)
seen = collections.Counter()
reader = csv.reader(sys.stdin)
next(reader)
for row in reader:
    pid, fen, moves, rating, rd, pop, plays, themes = row[:8]
    rating = int(rating); rd = int(rd); pop = int(pop); plays = int(plays)
    if rd > 100 or pop < 80 or plays < 200:
        continue
    bucket = min(max((rating // 100) * 100, 400), 3200)
    rec = (pid, fen, moves, rating, themes)
    for t in themes.split():
        if t not in THEMES: continue
        key = (t, bucket)
        seen[key] += 1
        lst = res[key]
        if len(lst) < per_bucket: lst.append(rec)
        else:
            j = random.randrange(seen[key])
            if j < per_bucket: lst[j] = rec
chosen = {}
for lst in res.values():
    for rec in lst: chosen[rec[0]] = rec
out = sorted(chosen.values(), key=lambda r: r[3])
sys.stdout.write('id\tfen\tmoves\trating\tthemes\n')
for r in out: sys.stdout.write(f'{r[0]}\t{r[1]}\t{r[2]}\t{r[3]}\t{r[4]}\n')
cnt = collections.Counter(t for r in out for t in r[4].split())
sys.stderr.write(f'total {len(out)}\n' + ' '.join(f'{t}:{cnt[t]}' for t in THEMES) + '\n')
