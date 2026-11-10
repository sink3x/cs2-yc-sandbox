#!/bin/sh
# Rejects traffic from the "steam" user (the CS2 process and its plugins) to the instance metadata service. Idempotent.
# Fails closed on purpose is NOT wanted here: if iptables is unavailable the game must still start, so errors are reported but not fatal.
set -u
UID_STEAM=$(id -u steam 2>/dev/null) || { echo "block-metadata: no user steam"; exit 0; }
RULE="-d 169.254.169.254 -m owner --uid-owner $UID_STEAM -j REJECT"
command -v iptables >/dev/null 2>&1 || { echo "block-metadata: iptables not found, metadata stays reachable for steam" >&2; exit 0; }
iptables -C OUTPUT $RULE 2>/dev/null || iptables -I OUTPUT 1 $RULE || { echo "block-metadata: could not add the rule" >&2; exit 0; }
echo "block-metadata: steam (uid $UID_STEAM) cannot reach 169.254.169.254"
