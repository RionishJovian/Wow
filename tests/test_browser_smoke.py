"""Network-free tests of the honest UI smoke-test acceptance criteria."""
from scripts.smoke_wowser_browser import summarize, local_ui_gate


def test_requires_actual_compiled_js_and_webgl2():
    assert summarize('resource-load-failed', True, True, 0)['smoke_passed'] is False
    assert summarize('resource-load-failed', True, True, 4,
                     missing_glue_xml=True)['assetless_probe_passed'] is True
    assert summarize('resource-load-failed', True, True, 4,
                     missing_glue_xml=False)['assetless_probe_passed'] is False
    for stage in (None, 'loading-ui', 'render-failed', 'bridge-ready'):
        assert summarize(stage, True, True, 0)['smoke_passed'] is False
    assert summarize('ui-loader-returned', False, True, 0)['smoke_passed'] is False
    assert summarize('first-render-call', True, False, 0)['smoke_passed'] is False
    assert summarize('first-render-call', True, True, 1)['smoke_passed'] is False


def test_never_reports_playable_client():
    for stage in ('first-render-call', 'resource-load-failed', None):
        result = summarize(stage, True, True, 0)
        assert result['gameplay_verified'] is False
        assert result['realm_connected'] is False
        assert result['assets_bundled'] is False


def test_expected_missing_ui_does_not_hide_actual_script_errors():
    report = summarize('resource-load-failed', True, True, 4, missing_glue_xml=True)
    assert report['uncaught_script_errors'] == 4
    assert report['smoke_passed'] is False
    assert report['gameplay_verified'] is False


def test_strict_local_ui_gate_rejects_assetless_probe_and_partial_stages():
    assert local_ui_gate(summarize('first-render-call', True, True, 0))
    assert not local_ui_gate(summarize('resource-load-failed', True, True, 0,
                                       missing_glue_xml=True))
    assert not local_ui_gate(summarize('ui-loader-returned', True, True, 0))
    assert not local_ui_gate(summarize('first-render-call', True, True, 1))
    assert not local_ui_gate(summarize('first-render-call', False, True, 0))
