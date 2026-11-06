import unittest
from pathlib import Path


class MediaWorkflowContractTests(unittest.TestCase):
    def test_workflow_does_not_block_audio_processing_on_vision_preload(self):
        workflow = Path(__file__).parents[1] / ".github" / "workflows" / "process-media-attachments.yml"
        text = workflow.read_text(encoding="utf-8")
        self.assertIn("timeout-minutes: 45", text)
        self.assertIn("command -v ffmpeg", text)
        self.assertIn("MEDIA_RUN_ONCE: 'true'", text)
        self.assertIn("MEDIA_CONVERSATION_ID: ${{ inputs.conversation_id }}", text)
        self.assertIn("conversation_id:", text)
        self.assertNotIn("Preload local vision model", text)

    def test_workflow_keeps_runs_from_cancelling_each_other(self):
        workflow = Path(__file__).parents[1] / ".github" / "workflows" / "process-media-attachments.yml"
        text = workflow.read_text(encoding="utf-8")
        self.assertIn("group: process-media-attachments", text)
        self.assertIn("cancel-in-progress: false", text)


if __name__ == "__main__":
    unittest.main()
