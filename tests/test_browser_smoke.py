"""No-network acceptance criteria for an actual compiled UI browser smoke gate."""
from scripts.smoke_wowser_browser import summarize


def test_accepts_only_real_script_loading_and_webgl2_ui_stage():
    assert summarize("resource-load-failed", True, True, 0)["smoke_passed"] is True
    for stage in (None, "loading-ui", "render-failed", "bridge-ready"):
        assert summarize(stage, True, True, 0)["smoke_passed"] is False
    assert summarize("ui-loader-returned", False, True, 0)["smoke_passed"] is False
    assert summarize("first-render-call", True, False, 0)["smoke_passed"] is False
    assert summarize("first-render-call", True, True, 1)["smoke_passed"] is False


def test_never_claims_real_wow_login_or_gameplay():
    for stage in ("first-render-call", "resource-load-failed", None):
        report = summarize(stage, True, True, 0)
        assert report["gameplay_verified"] is False
        assert report["realm_connected"] is False
        assert report["assets_bundled"] is False
