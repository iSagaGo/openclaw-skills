#!/usr/bin/env python3
"""轻量 HTTP 服务，为链上监控看板提供 API"""
import json
import os
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler
from datetime import datetime

STATE_FILE = "/tmp/gmgn_monitor_state.json"
ARCHIVE_DB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "archive", "archive_db.json")
WEB_DIR = os.path.dirname(os.path.abspath(__file__))
PORT = 8234


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def do_GET(self):
        if self.path == '/api/projects':
            self._serve_projects()
        elif self.path == '/api/archive':
            self._serve_archive()
        elif self.path == '/api/stats':
            self._serve_stats()
        else:
            super().do_GET()

    def _serve_json(self, data):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', len(body))
        self.end_headers()
        self.wfile.write(body)

    def _serve_projects(self):
        try:
            with open(STATE_FILE) as f:
                state = json.load(f)
            projects = list(state.get('notified_full', {}).values())
            now = int(time.time())
            for p in projects:
                ots = p.get('open_timestamp', 0)
                if ots:
                    p['age_hours'] = round((now - ots) / 3600, 1)
            projects.sort(key=lambda x: -x.get('open_timestamp', 0))
            self._serve_json({'count': len(projects), 'projects': projects})
        except Exception as e:
            self._serve_json({'error': str(e)})

    def _serve_archive(self):
        try:
            with open(ARCHIVE_DB) as f:
                db = json.load(f)
            self._serve_json(db)
        except Exception as e:
            self._serve_json({'error': str(e)})

    def _serve_stats(self):
        try:
            with open(STATE_FILE) as f:
                state = json.load(f)
            projects = list(state.get('notified_full', {}).values())
            now = int(time.time())
            active_48h = [p for p in projects if p.get('open_timestamp', 0) > now - 48*3600]
            ai_count = sum(1 for p in active_48h if p.get('is_ai_mining'))
            dup_count = sum(1 for p in active_48h if p.get('trust_rank'))
            self._serve_json({
                'total_tracked': len(projects),
                'active_48h': len(active_48h),
                'ai_mining': ai_count,
                'duplicates_scored': dup_count,
                'last_scan': state.get('last_scan', 0),
                'updated': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            })
        except Exception as e:
            self._serve_json({'error': str(e)})

    def log_message(self, format, *args):
        pass  # 静默日志


if __name__ == '__main__':
    print(f"Chain Monitor Dashboard: http://0.0.0.0:{PORT}")
    HTTPServer(('0.0.0.0', PORT), Handler).serve_forever()
