import json
from urllib.parse import urlparse, parse_qs

import importlib
import inspect
from pathlib import Path

GET_ROUTES = {}
POST_ROUTES = {}


def get_route(path, require_auth=True):
    def decorator(func):
        GET_ROUTES[path] = {
            "handler": func,
            "require_auth": require_auth
        }
        return func
    return decorator


def post_route(path, require_auth=True):
    def decorator(func):
        POST_ROUTES[path] = {
            "handler": func,
            "require_auth": require_auth
        }
        return func
    return decorator


def discover_routes():
    mixins = []
    current_dir = Path(__file__).parent
    for p in current_dir.glob("routes_*.py"):
        if p.stem == "routes_common":
            continue
        mod = importlib.import_module(p.stem)
        for name, cls in inspect.getmembers(mod, inspect.isclass):
            if cls.__module__ == mod.__name__ and name.endswith("Mixin"):
                mixins.append(cls)
    return mixins


def validate_json(required_keys=None):
    if required_keys is None:
        required_keys = []
    def decorator(func):
        def wrapper(self, *args, **kwargs):
            try:
                body = self._read_body()
                data = json.loads(body) if body else {}
            except Exception as e:
                self._send_json({"error": f"Invalid JSON body: {e}"}, 400)
                return
            for key in required_keys:
                if key not in data:
                    self._send_json({"error": f"Missing required key: '{key}'"}, 400)
                    return
            self.request_data = data
            return func(self, *args, **kwargs)
        wrapper.__name__ = func.__name__
        return wrapper
    return decorator


def validate_query(required_params=None):
    if required_params is None:
        required_params = []
    def decorator(func):
        def wrapper(self, *args, **kwargs):
            params = parse_qs(urlparse(self.path).query)
            for param in required_params:
                if param not in params:
                    self._send_json({"error": f"Missing required query parameter: '{param}'"}, 400)
                    return
            self.query_params = {k: v[0] for k, v in params.items()}
            return func(self, *args, **kwargs)
        wrapper.__name__ = func.__name__
        return wrapper
    return decorator
