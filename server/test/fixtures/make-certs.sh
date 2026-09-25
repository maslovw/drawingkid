#!/bin/sh
# Makes a fake App Store signing chain (root → intermediate → leaf, EC P-256) with the
# same marker extensions Apple uses, so tests can sign transactions that the verifier
# accepts when this root is pinned instead of Apple's. Run once; the output is committed.
set -e
cd "$(dirname "$0")"
cat > ext.cnf <<'CNF'
[intermediate]
basicConstraints = critical, CA:true, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
1.2.840.113635.100.6.2.1 = ASN1:NULL
[leaf]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
1.2.840.113635.100.6.11.1 = ASN1:NULL
CNF
for name in root intermediate leaf; do
  openssl ecparam -name prime256v1 -genkey -noout -out "$name.key"
done
openssl req -new -x509 -key root.key -subj "/CN=Test Root" -days 36500 \
  -addext "basicConstraints=critical,CA:true" -addext "keyUsage=critical,keyCertSign,cRLSign" -out root.pem </dev/null
openssl req -new -key intermediate.key -subj "/CN=Test Intermediate" -out intermediate.csr </dev/null
openssl x509 -req -in intermediate.csr -CA root.pem -CAkey root.key -CAcreateserial -days 36500 \
  -extfile ext.cnf -extensions intermediate -out intermediate.pem
openssl req -new -key leaf.key -subj "/CN=Test Leaf" -out leaf.csr </dev/null
openssl x509 -req -in leaf.csr -CA intermediate.pem -CAkey intermediate.key -CAcreateserial -days 36500 \
  -extfile ext.cnf -extensions leaf -out leaf.pem
rm -f ext.cnf ./*.csr ./*.srl root.key intermediate.key
