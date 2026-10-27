"""Create the HTTPS certificate for testing the web dev server on phones and tablets.

Over plain http://<lan-ip> the page is not a secure context, so crypto.randomUUID and
crypto.subtle are missing and adding files breaks. This keeps a private development CA in
webui/.certs (created once, never committed) and issues a fresh server certificate for
localhost and this PC's current network addresses on every run, so a new Wi-Fi or hotspot
address just needs `npm --prefix webui run dev:web:lan` again. Install ca.crt once on each
device (the dev server offers it at /el-sbobinator-dev-ca.crt) and trust it; nothing is
added to this PC's certificate store.
"""

from __future__ import annotations

import argparse
import datetime as dt
import ipaddress
import socket
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID

CERT_DIR = Path(__file__).resolve().parents[1] / "webui" / ".certs"
CA_NAME = "El Sbobinator Dev CA"
# Apple rejects TLS server certificates valid for more than 825 days; stay under the
# 398-day public limit so the certificate is accepted everywhere.
SERVER_DAYS = 397
CA_DAYS = 3650

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address


def lan_addresses() -> list[IPAddress]:
    found: set[IPAddress] = {ipaddress.ip_address("127.0.0.1")}
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.add(ipaddress.ip_address(info[4][0]))
    except OSError:
        pass
    # The address of the default route; connecting a UDP socket sends no packet.
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("192.0.2.1", 9))
            found.add(ipaddress.ip_address(probe.getsockname()[0]))
    except OSError:
        pass
    return sorted(
        (address for address in found if not address.is_link_local),
        key=lambda address: (not address.is_loopback, int(address)),
    )


def _now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def _write_key(path: Path, key: ec.EllipticCurvePrivateKey) -> None:
    path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
    )


def load_or_create_ca(
    cert_dir: Path,
) -> tuple[x509.Certificate, ec.EllipticCurvePrivateKey]:
    key_path, cert_path = cert_dir / "ca-key.pem", cert_dir / "ca.crt"
    if key_path.exists() and cert_path.exists():
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
        key = serialization.load_pem_private_key(key_path.read_bytes(), password=None)
        if isinstance(
            key, ec.EllipticCurvePrivateKey
        ) and cert.not_valid_after_utc > _now() + dt.timedelta(days=SERVER_DAYS):
            return cert, key
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, CA_NAME)])
    now = _now()
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=5))
        .not_valid_after(now + dt.timedelta(days=CA_DAYS))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.SubjectKeyIdentifier.from_public_key(key.public_key()), critical=False
        )
        .sign(key, hashes.SHA256())
    )
    _write_key(key_path, key)
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return cert, key


def issue_server_cert(
    cert_dir: Path, addresses: list[IPAddress], hostnames: list[str]
) -> x509.Certificate:
    ca_cert, ca_key = load_or_create_ca(cert_dir)
    key = ec.generate_private_key(ec.SECP256R1())
    now = _now()
    names: list[x509.GeneralName] = [x509.DNSName(host) for host in hostnames]
    names += [x509.IPAddress(address) for address in addresses]
    cert = (
        x509.CertificateBuilder()
        .subject_name(
            x509.Name(
                [x509.NameAttribute(NameOID.COMMON_NAME, "El Sbobinator dev server")]
            )
        )
        .issuer_name(ca_cert.subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=5))
        .not_valid_after(now + dt.timedelta(days=SERVER_DAYS))
        .add_extension(x509.SubjectAlternativeName(names), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False
        )
        .add_extension(
            x509.AuthorityKeyIdentifier.from_issuer_public_key(ca_key.public_key()),
            critical=False,
        )
        .sign(ca_key, hashes.SHA256())
    )
    _write_key(cert_dir / "server-key.pem", key)
    (cert_dir / "server.crt").write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return cert


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Create the dev HTTPS certificate for phones and tablets."
    )
    parser.add_argument("--cert-dir", type=Path, default=CERT_DIR)
    args = parser.parse_args(argv)
    cert_dir: Path = args.cert_dir
    cert_dir.mkdir(parents=True, exist_ok=True)
    addresses = lan_addresses()
    issue_server_cert(cert_dir, addresses, ["localhost"])
    print(f"Dev HTTPS certificate for: localhost, {', '.join(map(str, addresses))}")
    print(f"Device CA (install once, then trust it): {cert_dir / 'ca.crt'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
