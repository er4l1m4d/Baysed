import hashlib
from bayse_bot.bayse import canonical_json_bytes,sign_request,parse_quote
from bayse_bot.models import Outcome

def test_canonical_body_and_fixed_signature():
    body=canonical_json_bytes({"amount":100,"outcome":"YES","side":"BUY"})
    assert body==b'{"amount":100,"outcome":"YES","side":"BUY"}'
    # Independent construction fixes the HMAC contract: timestamp.METHOD.path.body_hash.
    assert sign_request("secret",1700000000,"POST","/v1/x",body)=="aSypOibuC6TXJNUW0jMgVl+QptWwBdx2HkAXjYsb808="
    assert hashlib.sha256(body).hexdigest()=="c452747cbc8631bf20bebae7a149d7ee63e43d923294190907721cc9e7909cb5"

def test_quote_requires_documented_clob_fields():
    q=parse_quote({"price":.5,"quantity":190,"fee":2,"amount":100,"completeFill":True},"BUY",Outcome.YES)
    assert q.expected_shares==190 and q.complete_fill
    try: parse_quote({"price":.5},"BUY",Outcome.YES)
    except ValueError: pass
    else: assert False
