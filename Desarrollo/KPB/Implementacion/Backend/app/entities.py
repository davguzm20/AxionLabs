"""Acceso a las entidades del sistema (KPB-ENT).

Python no puede importar un archivo con guion (KPB-ENT.py), asi que este modulo
lo carga una sola vez y reexporta sus clases:

    from app.entities import User, Wallet, Transaction, Category
"""

import importlib.util
import sys
from pathlib import Path

_MODULE_NAME = "app.kpb_ent"

if _MODULE_NAME in sys.modules:
    _entities = sys.modules[_MODULE_NAME]
else:
    _spec = importlib.util.spec_from_file_location(
        _MODULE_NAME, Path(__file__).with_name("KPB-ENT.py")
    )
    _entities = importlib.util.module_from_spec(_spec)
    sys.modules[_MODULE_NAME] = _entities
    _spec.loader.exec_module(_entities)

AccessLog = _entities.AccessLog
AccessStatus = _entities.AccessStatus
Category = _entities.Category
Currency = _entities.Currency
SourceType = _entities.SourceType
Transaction = _entities.Transaction
TransactionStatus = _entities.TransactionStatus
TransactionType = _entities.TransactionType
User = _entities.User
UserStatus = _entities.UserStatus
Wallet = _entities.Wallet
WalletType = _entities.WalletType

__all__ = [
    "AccessLog",
    "AccessStatus",
    "Category",
    "Currency",
    "SourceType",
    "Transaction",
    "TransactionStatus",
    "TransactionType",
    "User",
    "UserStatus",
    "Wallet",
    "WalletType",
]
