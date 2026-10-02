"""The residence's own calendar day and wall-clock time. Servers run in UTC,
but Kuwait is UTC+3, so date.today() would give the previous day between
midnight and 3am local. Instants (audit stamps, token expiry) stay in UTC."""

from datetime import date, datetime, time
from zoneinfo import ZoneInfo

LOCAL_TZ = ZoneInfo("Asia/Kuwait")


def local_today() -> date:
    return datetime.now(LOCAL_TZ).date()


def local_time() -> time:
    return datetime.now(LOCAL_TZ).time()
