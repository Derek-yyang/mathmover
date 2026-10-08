"""Meaningful regressions for catalog validation, telemetry and safe forwarding."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ggb_catalog
import ggb_parser


class CommandCatalogTests(unittest.TestCase):
    def check_valid(self, text):
        result = ggb_parser.validate_text(text)
        self.assertTrue(result["ok"], result["command_errors"])
        self.assertEqual(result["unknown_commands"], [])
        return result

    def test_unknown_calls_in_all_contexts(self):
        for line in ("Mystery(A)", "P = Mystery(A)", "pts = {Mystery(A)}",
                     "P = (Mystery(A), 0)", "P = Element({Mystery(A)}, 1)"):
            with self.subTest(line=line):
                result = ggb_parser.validate_text(line)
                self.assertEqual(result["unknown_commands"], ["mystery"])
                self.assertIn(line, ggb_parser.extract_valid_commands(line))

    def test_math_user_functions_and_string_contents_are_not_commands(self):
        self.check_valid('f(x) = sqrt(x^2 + 1)\nP = (2, f(2))\nText("Mystery(A), hi")')
        self.check_valid('A=(0,0)\nB=(2,0)\nP=Midpoint(A,B)+Vector(A,B)')
        self.check_valid('A=(0,0)\nB=(2,0)\nP=(A-B)+(B-A)')
        self.check_valid('f(u,v)=u^2+v^2\ng(u)=u^2\nP=(1,g(1))')

    def test_function_asymptote_list_and_curve_derivative_keep_return_types(self):
        self.check_valid('f(x)=1/x\nas=Asymptote(f)\na1=Element(as,1)')
        self.check_valid('c=Curve(cos(t),sin(t),t,0,6)\nd=Derivative(c)\nP=Point(d)')
        self.assertFalse(ggb_parser.validate_text('f(x)=x^2\nF=Focus(f(1))')["ok"])

    def test_known_bad_arity_is_not_forwarded(self):
        for line in ("P = Intersect(1)", "F = Focus(c, 2)", "SetColor(A)",
                     "P = Point(path, , 0.5)"):
            with self.subTest(line=line):
                result = ggb_parser.validate_text(line)
                self.assertFalse(result["ok"])
                self.assertTrue(result["has_command_errors"])
                self.assertNotIn(line, ggb_parser.extract_valid_commands(line))

    def test_incompatible_proven_types(self):
        for line in ("P = Intersect(1, 2)", "F = Focus(f)",
                     "SetFixed(A, 12)", "planeP = Plane(A, 2, 3)"):
            with self.subTest(line=line):
                result = ggb_parser.validate_text("A=(0,0)\nf(x)=x^2\n" + line)
                self.assertFalse(result["ok"])

    def test_unknown_object_types_deferred_to_engine(self):
        self.check_valid("P = Intersect(unknownLine, unknownConic)")

    def test_valid_overloads_previously_missed(self):
        self.check_valid('A=(0,0)\nB=(2,0)\nV=Vector(A,B)\n'
                         'R=Ray(A,V)\nP=Point(A,V)\n'
                         'SetBackgroundColor("White")\n'
                         'SetFixed(A,true,false)\n'
                         'Vertex(poly,2)\nIf(true,1,false,2,3)\n'
                         'Function(x+y,x,0,1,y,0,1)')

    def test_coordinate_root_point_cannot_be_used_as_number(self):
        result = ggb_parser.validate_text("f(x)=x^2-1\nP=(Root(f,0,2),0)")
        self.assertFalse(result["ok"])
        self.check_valid("f(x)=x^2-1\nP=Root(f,0,2)\nQ=(x(P),0)")

    def test_api_method_names_get_actionable_errors(self):
        result = ggb_parser.validate_text("SetAxesVisible(true,true)")
        self.assertFalse(result["ok"])
        self.assertIn("ShowAxes", str(result["command_errors"]))

    def test_dimensions_and_shared_curve(self):
        self.check_valid("MODE: 2D\nc=Curve(cos(t),sin(t),t,0,6)")
        self.check_valid("MODE: 3D\nc=Curve(cos(t),sin(t),t,t,0,6)")
        for line in ("s=Sphere((0,0,0),1)", "c=Curve(cos(t),sin(t),t,t,0,6)"):
            self.assertFalse(ggb_parser.validate_text("MODE: 2D\n"+line)["ok"])

    def test_aliases_retain_semantics_and_prompt_uses_canonical_names(self):
        result = self.check_valid("a=CircleArc((0,0),(1,0),(0,1))")
        self.assertEqual(result["ir"]["objects"][0]["kind"], "circulararc")
        names = ggb_parser.whitelist_command_names()
        self.assertIn("CircularArc", names["2d"])
        self.assertNotIn("CircleArc", names["2d"])

    def test_seed_is_global_and_remains_before_random_construction(self):
        text = "SetSeed(33)\na=random()\nSetColor(A,\"Blue\")"
        result = self.check_valid(text)
        self.assertEqual(result["ir"]["records"][0]["type"], "global")
        self.assertEqual(ggb_parser.extract_valid_commands(text)[0], "SetSeed(33)")

    def test_background_color_overloads_have_correct_scope(self):
        result = self.check_valid('SetBackgroundColor("White")\nA=(0,0)\nSetBackgroundColor(A,"Red")')
        self.assertEqual(result["ir"]["records"][0]["type"], "global")
        self.assertEqual(result["ir"]["records"][2]["type"], "attr")

    def test_script_commands_cannot_be_nested_or_assigned(self):
        for line in ('P=SetColor(A,"Blue")', 'If(true,ShowAxes(true),1)'):
            self.assertFalse(ggb_parser.validate_text(line)["ok"])

    def test_balancing_empty_args_and_escaped_strings(self):
        self.check_valid('Text("literal \\\"Mystery(A)\\\", commas, (brackets)")')
        self.check_valid('Text("literal \\\" // not a comment") // real comment')
        for line in ('P=Line(A,B', 'P=Line(A,B]', 'Text("unfinished)'):
            self.assertFalse(ggb_parser.validate_text(line)["ok"])

    def test_bracket_command_form(self):
        self.check_valid("A=(0,0)\nB=(1,0)\nM=Midpoint[A,B]")

    def test_plain_text_is_removed(self):
        self.assertEqual(ggb_parser.extract_valid_commands("MODE: 2D\n这里是说明\nA=(0,0)"),
                         ["MODE: 2D", "A=(0,0)"])

    def test_catalog_update_changes_prompt_and_parser_in_same_process(self):
        original = json.loads(ggb_catalog.CATALOG_PATH.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "commands.json"
            path.write_text(json.dumps(original), encoding="utf-8")
            with patch.object(ggb_catalog, "CATALOG_PATH", path):
                self.assertNotIn("FreshCommand", ggb_parser.whitelist_command_names()["2d"])
                original["constructors"]["2d"].append("FreshCommand")
                path.write_text(json.dumps(original), encoding="utf-8")
                self.assertIn("FreshCommand", ggb_parser.whitelist_command_names()["2d"])
                self.check_valid("P=FreshCommand(A)")


if __name__ == "__main__":
    unittest.main()
