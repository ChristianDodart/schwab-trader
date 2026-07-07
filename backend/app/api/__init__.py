"""APIRouter modules split out of app/main.py — main.py is the composition root
that creates the FastAPI app and includes each router here.

NOTE: these modules import shared plumbing (_selected, _csv_response,
CsvImportBody, _restart_stream, strategy) from app.main, so they must only be
imported AFTER main.py has defined those names — main.py does the router imports
near the bottom of the module for exactly that reason. Import app.main (not a
submodule here) as the entry point.
"""
