import unittest
from unittest.mock import Mock, patch

import worker


class LocalVisionContractTests(unittest.TestCase):
    def test_local_model_json_is_parsed_from_markdown_wrapper(self):
        parsed = worker._parse_vision_json(
            '```json\n{"object_type":"vehicle","vehicle":{"make":"Chevrolet","model":"Equinox","type":"SUV"}}\n```'
        )
        self.assertEqual(parsed["vehicle"]["model"], "Equinox")

    def test_vehicle_phone_and_documents_become_additive_conversation_evidence(self):
        text = worker._image_evidence_text({
            "object_type": "vehicle",
            "phone": "(804) 393-7976",
            "vehicle": {"make": "Chevrolet", "model": "Equinox", "type": "SUV"},
            "documents": {
                "identification": "yes",
                "proof_of_income": "yes",
                "pay_stubs": "yes",
                "insurance": "unknown",
            },
        })
        self.assertIn("vehicle: Chevrolet Equinox", text)
        self.assertIn("phone: (804) 393-7976", text)
        self.assertIn("I have my driver's license", text)
        self.assertIn("I have proof of income", text)
        self.assertIn("I have a pay stub", text)

    def test_unknown_visual_findings_are_not_invented(self):
        text = worker._image_evidence_text({"object_type": "other"})
        self.assertIn("image type: other", text)
        self.assertNotIn("vehicle:", text)
        self.assertNotIn("proof of income", text)

    def test_description_still_classifies_a_safe_vehicle_type(self):
        text = worker._image_evidence_text({"description": "A red truck parked outside."})
        self.assertIn("vehicle_type: Truck", text)

    def test_description_classifies_special_vehicle_categories(self):
        self.assertIn("vehicle_type: Luxury sedan", worker._image_evidence_text({"description": "A luxury sedan."}))
        self.assertIn("vehicle_type: Sports car", worker._image_evidence_text({"description": "A muscle car."}))

    def test_no_openai_configuration_is_required(self):
        self.assertFalse(hasattr(worker, "MEDIA_VISION_API_KEY"))
        self.assertEqual(worker.LOCAL_VISION_MODEL_NAME, "HuggingFaceTB/SmolVLM-500M-Instruct")

    def test_audio_transcription_is_marked_as_an_inbound_conversation_source(self):
        self.assertEqual(worker.derived_message_source("audio", {"engine": "faster-whisper"}), "audio_transcription")
        self.assertEqual(worker.derived_message_source("image", {"vision_status": "processed"}), "image_interpretation")
        self.assertEqual(worker.derived_message_source("image", {"vision_status": "unavailable"}), "image_ocr")


class ReconciliationCallbackTests(unittest.TestCase):
    def test_callback_requires_an_accepted_api_payload(self):
        response = Mock(status_code=200)
        response.json.return_value = {"accepted": True, "status": "waiting_window"}
        with patch.object(worker, "DEALERADMIN_API_URL", "https://dealeradmin.test/api"), \
             patch.object(worker, "GHL_WEBHOOK_SECRET", "secret"), \
             patch.object(worker.requests, "post", return_value=response) as post:
            self.assertTrue(worker.notify_reconciliation("conversation-1"))
        post.assert_called_once_with(
            "https://dealeradmin.test/api/webhooks/ghl/conversations/conversation-1/reconcile-media",
            json={},
            headers={"X-DealerADMIN-Webhook-Secret": "secret"},
            timeout=worker.RECONCILIATION_TIMEOUT,
        )

    def test_callback_retries_when_a_success_status_has_no_acceptance(self):
        response = Mock(status_code=200)
        response.json.return_value = {"accepted": False, "status": "partial"}
        with patch.object(worker, "DEALERADMIN_API_URL", "https://dealeradmin.test/api"), \
             patch.object(worker, "GHL_WEBHOOK_SECRET", "secret"), \
             patch.object(worker.requests, "post", return_value=response):
            self.assertFalse(worker.notify_reconciliation("conversation-2"))


if __name__ == "__main__":
    unittest.main()
