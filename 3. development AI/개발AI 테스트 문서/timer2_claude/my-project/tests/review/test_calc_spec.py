# 테스트AI 자리. PRD만 보고 독립적으로 만든 검사가 들어간다.
from src.calc import add


def test_add_negative():
    assert add(-1, -1) == -2