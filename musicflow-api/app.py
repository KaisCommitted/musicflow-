import os
import sys
import threading
import webview
from server import app


def start_server():
    app.run(debug=False, port=5000, use_reloader=False)


def get_icon_path():
    if getattr(sys, 'frozen', False):
        base = sys._MEIPASS
    else:
        base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, 'music.ico')


if __name__ == "__main__":
    # Start Flask in a background thread
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()

    icon = get_icon_path()
    # Open native desktop window
    webview.create_window(
        "Musicflow",
        "http://127.0.0.1:5000",
        width=900,
        height=750,
        min_size=(600, 400),
    )
    webview.start(icon=icon)
