import datetime as dt
import ipaddress

from cryptography import x509
from cryptography.x509.oid import ExtendedKeyUsageOID

from scripts import dev_https_cert
from scripts.dev_https_cert import issue_server_cert, lan_addresses, main

LAN = ipaddress.ip_address("192.168.1.20")
LOOPBACK = ipaddress.ip_address("127.0.0.1")


def test_server_certificate_names_every_address_and_chains_to_the_dev_ca(tmp_path):
    cert = issue_server_cert(tmp_path, [LOOPBACK, LAN], ["localhost"])
    ca = x509.load_pem_x509_certificate((tmp_path / "ca.crt").read_bytes())

    cert.verify_directly_issued_by(ca)
    names = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    assert names.get_values_for_type(x509.DNSName) == ["localhost"]
    assert names.get_values_for_type(x509.IPAddress) == [LOOPBACK, LAN]
    usage = cert.extensions.get_extension_for_class(x509.ExtendedKeyUsage).value
    assert list(usage) == [ExtendedKeyUsageOID.SERVER_AUTH]
    # iOS refuses longer-lived TLS server certificates.
    lifetime = cert.not_valid_after_utc - cert.not_valid_before_utc
    assert lifetime <= dt.timedelta(days=398)
    assert ca.extensions.get_extension_for_class(x509.BasicConstraints).value.ca
    assert (
        (tmp_path / "server-key.pem").read_bytes().startswith(b"-----BEGIN PRIVATE KEY")
    )


def test_new_network_address_reissues_the_server_certificate_with_the_same_ca(tmp_path):
    # The CA is installed on the devices once; only the server certificate may change.
    issue_server_cert(tmp_path, [LOOPBACK, LAN], ["localhost"])
    ca_before = (tmp_path / "ca.crt").read_bytes()
    hotspot = ipaddress.ip_address("172.20.10.2")

    cert = issue_server_cert(tmp_path, [LOOPBACK, hotspot], ["localhost"])

    assert (tmp_path / "ca.crt").read_bytes() == ca_before
    names = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    assert names.get_values_for_type(x509.IPAddress) == [LOOPBACK, hotspot]


def test_lan_addresses_put_loopback_first_and_drop_link_local(monkeypatch):
    monkeypatch.setattr(
        dev_https_cert.socket,
        "getaddrinfo",
        lambda *_: [
            (None, None, None, "", (ip, 0)) for ip in ("169.254.3.4", "10.0.0.7")
        ],
    )
    assert lan_addresses()[0] == LOOPBACK
    assert ipaddress.ip_address("10.0.0.7") in lan_addresses()
    assert ipaddress.ip_address("169.254.3.4") not in lan_addresses()


def test_main_writes_the_files_the_lan_dev_server_reads(tmp_path, capsys):
    assert main(["--cert-dir", str(tmp_path / "certs")]) == 0
    written = {path.name for path in (tmp_path / "certs").iterdir()}
    assert written == {"ca.crt", "ca-key.pem", "server.crt", "server-key.pem"}
    assert "ca.crt" in capsys.readouterr().out
