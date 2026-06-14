import json
import sys
from urllib.parse import urlparse, parse_qs

GET_ROUTES = {}
POST_ROUTES = {}

_MAX_JSON_BODY = 5 * 1024 * 1024


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

def validate_json(required_keys=None):
    if required_keys is None:
        required_keys = []
    def decorator(func):
        def wrapper(self, *args, **kwargs):
            try:
                try:
                    length = int(self.headers.get("Content-Length", 0))
                except ValueError:
                    length = 0
                if length > _MAX_JSON_BODY:
                    self._send_json({"error": "Payload too large"}, 413)
                    return
                body = self._read_body()
                if body:
                    try:
                        decoded_body = body.decode("utf-8")
                    except UnicodeDecodeError as e:
                        self._send_json({"error": f"Invalid UTF-8 encoding: {e}"}, 400)
                        return
                    data = json.loads(decoded_body)
                else:
                    data = {}
            except json.JSONDecodeError as e:
                self._send_json({"error": f"Invalid JSON body: {e}"}, 400)
                return
            except Exception as e:
                self._send_json({"error": f"Failed to read request body: {e}"}, 400)
                return
            if not isinstance(data, dict):
                self._send_json({"error": "JSON body must be an object"}, 400)
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
