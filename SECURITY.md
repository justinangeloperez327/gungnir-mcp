# Security

Do not report exploitable vulnerabilities in public issues. Use GitHub's private vulnerability reporting feature if available, or contact the maintainer privately.

Group 1 exposes only `gungnir_status`, which does not access projects or execute commands. Future changes introducing Gungnir CLI execution, filesystem mutations, or transport security must be reviewed before enabling those capabilities.

See [docs/security.md](docs/security.md).
