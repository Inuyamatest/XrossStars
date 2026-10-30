"""クロスファイト — 起動スクリプト（python main.py）"""
import os
import sys

import pygame

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from game import config as C  # noqa: E402
from game.audio import Audio  # noqa: E402
from game.scenes import Settings, TitleScene  # noqa: E402
from game.chars import CHARS, CHAR_BY_KEY  # noqa: E402
from game.spritechars import discover  # noqa: E402


def load_extra_chars():
    """mugen/ と charpacks/ に置いたキャラを追加する。"""
    found, errors = discover()
    for c in found:
        if c.key not in CHAR_BY_KEY:
            CHARS.append(c)
            CHAR_BY_KEY[c.key] = c
    for folder, err in errors:
        print('[キャラ読み込み失敗] %s: %s' % (folder, err))


class App:
    def __init__(self):
        pygame.init()
        pygame.joystick.init()
        pygame.display.set_caption('クロスファイト ～大乱闘アリーナ～')
        flags = pygame.SCALED | pygame.RESIZABLE
        self.screen = pygame.display.set_mode((C.W, C.H), flags, vsync=1)
        self.clock = pygame.time.Clock()
        self.audio = Audio()
        load_extra_chars()
        self.settings = Settings()
        self.scene = TitleScene(self)
        self.running = True

    def run(self, max_frames=None):
        n = 0
        while self.running:
            for e in pygame.event.get():
                if e.type == pygame.QUIT:
                    self.running = False
                elif e.type == pygame.KEYDOWN and e.key == pygame.K_F11:
                    pygame.display.toggle_fullscreen()
                elif e.type == pygame.KEYDOWN and e.key == pygame.K_m and not hasattr(self.scene, 'world'):
                    self.audio.muted = not self.audio.muted
                else:
                    self.scene.handle(e)
            self.scene.update()
            self.scene.draw(self.screen)
            pygame.display.flip()
            self.clock.tick(C.FPS)
            n += 1
            if max_frames and n >= max_frames:
                break
        pygame.quit()


if __name__ == '__main__':
    App().run()
