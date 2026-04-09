import unittest
from unittest.mock import patch

from el_sbobinator.ffmpeg_utils import preconvert_to_mono16k_mp3


class PreconvertToMono16kMp3CommandTests(unittest.TestCase):
    def _captured_cmd(self, extra_kwargs=None):
        """Run preconvert_to_mono16k_mp3 with a fake runner and return the command it built."""
        captured = {}

        def fake_run(cmd, *, stop_event=None):
            captured["cmd"] = list(cmd)
            return 0, "", "", False

        with patch("el_sbobinator.ffmpeg_utils._run_cancellable", side_effect=fake_run):
            with patch(
                "el_sbobinator.ffmpeg_utils.get_ffmpeg_exe", return_value="ffmpeg"
            ):
                with patch("os.path.exists", return_value=True):
                    with patch("os.path.getsize", return_value=4096):
                        kwargs = dict(
                            input_path="lesson.mp3",
                            output_path="/tmp/out.partial.mp3",
                            bitrate="48k",
                        )
                        if extra_kwargs:
                            kwargs.update(extra_kwargs)
                        preconvert_to_mono16k_mp3(**kwargs)
        return captured.get("cmd", [])

    def test_explicit_mp3_format_flag_present_before_output_path(self):
        cmd = self._captured_cmd()
        self.assertIn("-f", cmd)
        self.assertIn("mp3", cmd)
        f_idx = cmd.index("-f")
        self.assertEqual(cmd[f_idx + 1], "mp3")
        output_idx = cmd.index("/tmp/out.partial.mp3")
        self.assertEqual(
            f_idx + 2,
            output_idx,
            "-f mp3 must be the two tokens immediately before the output path",
        )

    def test_format_flag_present_regardless_of_output_extension(self):
        cmd = self._captured_cmd({"output_path": "/tmp/out.somerandomeext"})
        f_idx = cmd.index("-f")
        self.assertEqual(cmd[f_idx + 1], "mp3")
        output_idx = cmd.index("/tmp/out.somerandomeext")
        self.assertEqual(f_idx + 2, output_idx)

    def test_chunk_cut_commands_are_not_affected(self):
        from el_sbobinator.ffmpeg_utils import cut_chunk_to_mp3

        captured = {}

        def fake_run(cmd, *, stop_event=None):
            captured["cmd"] = list(cmd)
            return 0, "", "", False

        with patch("el_sbobinator.ffmpeg_utils._run_cancellable", side_effect=fake_run):
            with patch(
                "el_sbobinator.ffmpeg_utils.get_ffmpeg_exe", return_value="ffmpeg"
            ):
                with patch("os.path.exists", return_value=True):
                    with patch("os.path.getsize", return_value=4096):
                        cut_chunk_to_mp3(
                            input_path="lesson.mp3",
                            output_path="/tmp/chunk.mp3",
                            start_sec=0,
                            duration_sec=60,
                        )

        cmd = captured.get("cmd", [])
        f_indices = [i for i, tok in enumerate(cmd) if tok == "-f"]
        self.assertEqual(f_indices, [], "cut_chunk_to_mp3 must not contain -f flag")


if __name__ == "__main__":
    unittest.main()
