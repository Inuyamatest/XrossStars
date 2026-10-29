"""ヘッドレスでCPU同士を戦わせ、例外・NaN・終わらない試合がないか確かめる。

  python -m tests.test_sim        （smash-game フォルダで実行）
"""
import math
import os
import random
import sys

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from game.chars import CHARS  # noqa: E402
from game.stage import STAGE_KEYS  # noqa: E402
from game.world import World, calc_kb  # noqa: E402
from game.ai import CpuController  # noqa: E402


def run_match(chars, stage, level=7, seed=0, stocks=2, max_frames=60 * 60 * 6):
    rng = random.Random(seed)
    entries = [(c, CpuController(level, rng), True) for c in chars]
    w = World(stage, entries, stocks=stocks, seed=seed, countdown=False)
    states = set()
    while not w.over and w.frame < max_frames:
        w.step()
        w.events.clear()
        for f in w.fighters:
            for v in (f.x, f.y, f.vx, f.vy, f.kx, f.ky, f.damage):
                assert not math.isnan(v) and not math.isinf(v), (f.char.key, f.state)
            states.add(f.state)
    return w, states


def test_kb_formula():
    # 100%付近の横スマで kb がだいたい170〜190
    kb = calc_kb(116, 16, 100, 35, 100)
    assert 160 < kb < 200, kb


def test_matches():
    total_frames = 0
    unfinished = 0
    states = set()
    n = 0
    for i, a in enumerate(CHARS):
        for j, b in enumerate(CHARS):
            stage = STAGE_KEYS[(i + j) % len(STAGE_KEYS)]
            w, st = run_match([a, b], stage, seed=i * 10 + j)
            states |= st
            total_frames += w.frame
            n += 1
            if not w.over:
                unfinished += 1
            print('  %-6s vs %-6s @%-11s %5.1fs  winner=%s  %s' % (
                a.key, b.key, stage, w.frame / 60, w.winner.char.key if w.winner else '-',
                ' '.join('%s:ko%d/fall%d' % (f.char.key, f.kos, f.falls) for f in w.fighters)))
    print('  平均試合時間 %.1f秒 / 未決着 %d / 出現した状態 %s' % (total_frames / n / 60, unfinished, sorted(states)))
    assert unfinished <= n // 4, unfinished
    for s in ('hitstun', 'shield', 'hold', 'grabbed', 'ledge', 'move'):
        assert s in states, s


def test_four_players():
    for seed in range(3):
        w, _ = run_match(CHARS[:4], 'battlefield', seed=100 + seed, stocks=2)
        assert w.over


if __name__ == '__main__':
    test_kb_formula()
    test_matches()
    test_four_players()
    print('ok')
