import hashlib
import json
import unittest
from pathlib import Path

from el_sbobinator.core.generation_profile import GENERATION_PROFILE
from el_sbobinator.core.model_registry import (
    _LEGACY_MODEL_ALIASES,
    DEFAULT_MODEL,
    MODEL_OPTIONS,
    SUPPORTED_MODELS,
)
from el_sbobinator.core.prompts import PROMPT_REVISIONE, PROMPT_SISTEMA
from el_sbobinator.services.generation_service import build_chunk_prompt

PROFILE_PATH = (
    Path(__file__).resolve().parents[2] / "el_sbobinator" / "generation_profile.json"
)


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class GenerationProfileTests(unittest.TestCase):
    # Moving the texts into generation_profile.json must not change a single byte
    # of what the desktop sends to Gemini: these are the constants before the move.
    def test_prompts_equal_the_previous_python_constants(self):
        self.assertEqual(len(PROMPT_SISTEMA), 3102)
        self.assertEqual(
            _sha256(PROMPT_SISTEMA),
            "7dcacaaecd75f97bdf68e5e846d297950cc9e816650be161a3b6392364ce20c4",
        )
        self.assertEqual(len(PROMPT_REVISIONE), 1345)
        self.assertEqual(
            _sha256(PROMPT_REVISIONE),
            "70fd33bef767a23a02cc58b48235b2606e13bb405cd687edbe9db70016ce3f78",
        )

    def test_chunk_prompt_equals_the_previous_builder(self):
        base = (
            "Trascrivi TUTTO il contenuto di questo blocco audio seguendo rigorosamente le istruzioni di sistema. "
            "Non omettere nessun concetto, esempio, cifra o termine tecnico. "
            "Non riassumere: la lunghezza dell'output deve essere proporzionale a quella dell'audio. "
            "Ogni paragrafo generato deve essere unico: non ripetere mai lo stesso paragrafo o frase."
        )
        tail = 'coda {x} "citata"'
        self.assertEqual(build_chunk_prompt(""), base)
        self.assertEqual(
            build_chunk_prompt(tail),
            base
            + "\n\nATTENZIONE: Stai continuando una stesura. Questo è l'ultimo paragrafo che hai generato nel blocco precedente:\n"
            + f'"...{tail}"\n\n'
            + "Riprendi il discorso da qui IN MODO FLUIDO. Usa la stessa grandezza per i titoli. "
            + "Se all'inizio di questo blocco c'è sovrapposizione, NON ripetere testualmente le frasi già dette, "
            + "ma se compare anche solo un dettaglio nuovo includilo.",
        )

    def test_models_equal_the_previous_registry(self):
        self.assertEqual(
            MODEL_OPTIONS,
            (
                {
                    "id": "gemini-2.5-flash",
                    "label": "Gemini 2.5 Flash",
                    "summary": "",
                    "default_chunk_minutes": 15,
                    "default_macro_char_limit": 22000,
                    "phase1_temperature": 0.35,
                    "phase1_thinking_budget": 16384,
                },
                {
                    "id": "gemini-3.6-flash",
                    "label": "Gemini 3.6 Flash",
                    "summary": "",
                    "default_chunk_minutes": 15,
                    "default_macro_char_limit": 22000,
                    "phase1_temperature": 0.35,
                    "is_default": True,
                },
                {
                    "id": "gemini-3.8-flash",
                    "label": "Gemini 3.8 Flash",
                    "summary": "",
                    "default_chunk_minutes": 15,
                    "default_macro_char_limit": 22000,
                    "phase1_temperature": 0.35,
                },
            ),
        )
        self.assertEqual(
            SUPPORTED_MODELS,
            ("gemini-2.5-flash", "gemini-3.6-flash", "gemini-3.8-flash"),
        )
        self.assertEqual(DEFAULT_MODEL, "gemini-3.6-flash")
        self.assertEqual(
            _LEGACY_MODEL_ALIASES,
            {
                "gemini-3.5-flash": "gemini-3.6-flash",
                "gemini-3.7-flash": "gemini-3.8-flash",
            },
        )

    # webui/src/generationProfile.test.ts checks the same file from the TypeScript side.
    def test_profile_file_is_what_python_loads(self):
        on_disk = json.loads(PROFILE_PATH.read_text(encoding="utf-8"))
        self.assertEqual(on_disk, GENERATION_PROFILE)
        self.assertEqual(on_disk["prompts"]["system"], PROMPT_SISTEMA)
        self.assertEqual(on_disk["prompts"]["revision"], PROMPT_REVISIONE)
        self.assertEqual(
            [opt["id"] for opt in on_disk["models"]["options"]],
            list(SUPPORTED_MODELS),
        )
        self.assertIn("{previous_tail}", on_disk["prompts"]["chunk_continuation"])


if __name__ == "__main__":
    unittest.main()
