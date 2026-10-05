"""Called by auditP2PBaseline.js after its development-project guard; never calls RPCs."""
import concurrent.futures
import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Keep credential headers on the validated project endpoint.
        return None


def capture(target):
    origin = target['restOrigin']
    parsed = urllib.parse.urlparse(origin)
    if parsed.scheme != 'https' or parsed.netloc != target['projectRef'] + '.supabase.co':
        raise ValueError('Invalid target')
    if origin != os.environ['SUPABASE_URL'].rstrip('/'):
        raise ValueError('Binding mismatch')
    headers = {'apikey': os.environ['SUPABASE_SERVICE_ROLE_KEY'],
               'Authorization': 'Bearer ' + os.environ['SUPABASE_SERVICE_ROLE_KEY']}

    def request(suffix, method='GET'):
        # urllib honors the cloud HTTPS proxy and verifies TLS by default.
        opener = urllib.request.build_opener(NoRedirect())
        req = urllib.request.Request(origin + '/rest/v1/' + suffix,
                                     headers={**headers, 'Prefer': 'count=exact',
                                              'Accept': 'application/openapi+json' if not suffix else 'application/json'},
                                     method=method)
        return opener.open(req, timeout=15)

    with request('') as response:
        definitions = json.load(response).get('definitions', {})

    def count(table):
        if not re.fullmatch(r'[a-z_]+', table):
            raise ValueError('Invalid table identifier')
        if table not in definitions:
            return table, {'status': 'not_exposed'}
        try:
            with request(table + '?select=id', 'HEAD') as response:
                total = response.headers.get('Content-Range', '').split('/')[-1]
                if total.isdigit():
                    return table, {'status': 'measured', 'visible_row_count': total}
                return table, {'status': 'unavailable', 'reason': 'exact_count_not_returned'}
        except urllib.error.HTTPError as error:
            return table, {'status': 'unavailable', 'http_status': error.code}
        except Exception:
            return table, {'status': 'unavailable', 'reason': 'https_read_failed'}

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        counts = dict(pool.map(count, target['tables']))
    exposed_columns = {
        table: {column: {key: value for key, value in properties.items() if key in ('type', 'format')}
                for column, properties in definitions.get(table, {}).get('properties', {}).items()}
        for table in target['tables'] if table in definitions
    }
    return {'kind': 'p2p-development-baseline', 'project_ref': target['projectRef'],
            'captured_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'evidence': 'postgrest_exposure_and_visible_row_counts', 'capture_complete': False,
            'snapshot_consistent': False, 'exposed_columns': exposed_columns, 'row_counts': counts,
            'checks': {'status': 'not_run', 'reason': 'financial_join_checks_require_postgres'},
            'limitations': ['OpenAPI exposure is not a complete PostgreSQL catalog.',
                            'Numeric formats do not reveal precision or scale.',
                            'Independent HTTP requests do not share a transaction snapshot.',
                            'Counts are visible to the supplied service role, not an application-user permission test.',
                            'Constraints, triggers, RLS, grants and migration history remain unverified.']}


if __name__ == '__main__':
    try:
        print(json.dumps(capture(json.load(sys.stdin))))
    except Exception:
        # Do not expose raw response bodies, credentials or redirect locations.
        print('HTTPS baseline failed', file=sys.stderr)
        sys.exit(1)
