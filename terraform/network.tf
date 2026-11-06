resource "yandex_vpc_network" "main" {
  name = "${var.name_prefix}-net"
}

resource "yandex_vpc_subnet" "main" {
  name           = "${var.name_prefix}-subnet"
  zone           = var.zone
  network_id     = yandex_vpc_network.main.id
  v4_cidr_blocks = [var.subnet_cidr]
}

# Static public addresses: the connect string and the panel URL never change.
resource "yandex_vpc_address" "cs2" {
  name = "${var.name_prefix}-game-ip"
  external_ipv4_address {
    zone_id = var.zone
  }
}

resource "yandex_vpc_address" "admin" {
  name = "${var.name_prefix}-panel-ip"
  external_ipv4_address {
    zone_id = var.zone
  }
}

resource "yandex_vpc_security_group" "admin" {
  name       = "${var.name_prefix}-panel-sg"
  network_id = yandex_vpc_network.main.id

  ingress {
    description    = "panel HTTPS"
    protocol       = "TCP"
    port           = 443
    v4_cidr_blocks = var.panel_allowed_cidrs
  }
  ingress {
    description    = "panel HTTP (ACME challenge + redirect)"
    protocol       = "TCP"
    port           = 80
    v4_cidr_blocks = ["0.0.0.0/0"]
  }
  dynamic "ingress" {
    for_each = var.ssh_public_key == "" ? [] : [1]
    content {
      description    = "ssh"
      protocol       = "TCP"
      port           = 22
      v4_cidr_blocks = var.ssh_allowed_cidrs
    }
  }
  egress {
    description    = "all outbound"
    protocol       = "ANY"
    from_port      = 0
    to_port        = 65535
    v4_cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "yandex_vpc_security_group" "cs2" {
  name       = "${var.name_prefix}-game-sg"
  network_id = yandex_vpc_network.main.id

  ingress {
    description    = "CS2 game traffic"
    protocol       = "UDP"
    port           = 27015
    v4_cidr_blocks = ["0.0.0.0/0"]
  }
  # RCON (TCP 27015) is intentionally NOT exposed: the panel talks to the agent, the agent talks to RCON on loopback.
  ingress {
    description       = "agent API, only from the admin VM"
    protocol          = "TCP"
    port              = 8081
    security_group_id = yandex_vpc_security_group.admin.id
  }
  dynamic "ingress" {
    for_each = var.ssh_public_key == "" ? [] : [1]
    content {
      description    = "ssh"
      protocol       = "TCP"
      port           = 22
      v4_cidr_blocks = var.ssh_allowed_cidrs
    }
  }
  egress {
    description    = "all outbound"
    protocol       = "ANY"
    from_port      = 0
    to_port        = 65535
    v4_cidr_blocks = ["0.0.0.0/0"]
  }
}
