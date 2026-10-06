# Hadlaan House recipe import

`hadlaan-recipes.json` holds 84 recipes transcribed from the chef's sheets, ready to load into the app.

## How to import (owner only)

1. Sign in as the owner. Go to **Kitchen → Recipes → Import recipes**.
2. Choose `hadlaan-recipes.json`. The app shows what it *would* do: recipes to create, recipes that already exist (skipped),
   problems, and every new stock item. Nothing is saved yet.
3. Review, then press **Import 84 recipes**.

It is safe to run again: recipes that already exist by name are skipped. Missing ingredients are created as stock items and
Item Master entries at **zero quantity and zero cost**, so recipe costs read 0 until goods are received through a GRN.
Existing stock items are matched by name (case-insensitive); if your stock already has the same ingredient under a different
name (for example "Butter" and "Unsalted butter"), the preview lists the new name so you can decide.

## What was corrected (recipe content not changed)

* Cappelletti dough method said "wheat starch and tapioca starch" for a gluten-free dough; written to match its ingredient
  list (tapioca, rice and potato starch, xanthan gum, salt).
* Pasta madre step 3 said "whole wheat flour"; the ingredient list says whole rye flour. Rye used.
* Panettone second dough method said "2 g barley malt"; the ingredient list says 2 g extra honey. Honey used.
* Ajoblanco listed "almond milk 120–160 g" but every step uses water. Entered as water (not costed).
* Crispy sandwich bread said "10 breads of about 100 g", but the ingredients make about 1,700 g, i.e. 17 breads. Portions = 17.
* Focaccia oregano "05gm" read as 5 g.
* Two different "Pâte sablée" recipes were renamed "(Vanilla Almond)" and "(Classic)".
* Duplicate ingredient lines were merged (for example the three sugar amounts in the tiramisu) and counts converted to
  weights using the sheets' own figures (1 yolk ≈ 18 g, 1 white ≈ 30 g, 1 whole egg ≈ 50 g).
* Soufflé pancakes keep xanthan gum at 4 g as written; please confirm it against your tested formula.

Each recipe's **Notes** repeats anything it needed (chef's notes, what is not costed, source checks).

## Not costed

Ingredients with no quantity ("as required", frying oil, dusting flour, water) are not costed, and the notes say so. Water and
other volume items do not count toward a recipe's raw weight, so when a recipe is used as a sub-recipe its cost per gram can
read slightly high.

## Not imported (the source had no usable quantities or recipe)

* Rhubarb compote (no rhubarb quantity) and the soaked lemon pound cake syrup (given only in "parts").
* Black sesame financier (the sheet supplied a lemon cake instead).
* Seasoned mushrooms and bone marrow emulsion for the beef tartare; the tartare is entered per portion with only the beef
  and caviar costed.
* Spiced carrot reduction (used in the carrot soufflé, no recipe given).
* Plated assemblies with no per-portion amounts (saffron cups per cup, cappelletti count, chocolate fumé, soaked lemon cake
  plate). Their components are all present.
