using System.Collections;
using System.Data;
using System.Data.Common;

namespace HttpInspector.Adapter;

/// <summary>Observes the rows the application reads; it never executes a second database command.</summary>
internal sealed class HttpInspectorDbDataReader(DbDataReader inner, HttpInspectorDatabaseCapture capture, DatabaseCaptureSession session) : DbDataReader
{
    private bool _readerCompleted;

    public override int Depth => inner.Depth;
    public override int FieldCount => inner.FieldCount;
    public override bool HasRows => inner.HasRows;
    public override bool IsClosed => inner.IsClosed;
    public override int RecordsAffected => inner.RecordsAffected;
    public override object this[int ordinal] => inner[ordinal];
    public override object this[string name] => inner[name];
    public override bool GetBoolean(int ordinal) => inner.GetBoolean(ordinal);
    public override byte GetByte(int ordinal) => inner.GetByte(ordinal);
    public override long GetBytes(int ordinal, long dataOffset, byte[]? buffer, int bufferOffset, int length) => inner.GetBytes(ordinal, dataOffset, buffer, bufferOffset, length);
    public override char GetChar(int ordinal) => inner.GetChar(ordinal);
    public override long GetChars(int ordinal, long dataOffset, char[]? buffer, int bufferOffset, int length) => inner.GetChars(ordinal, dataOffset, buffer, bufferOffset, length);
    public override string GetDataTypeName(int ordinal) => inner.GetDataTypeName(ordinal);
    public override DateTime GetDateTime(int ordinal) => inner.GetDateTime(ordinal);
    public override decimal GetDecimal(int ordinal) => inner.GetDecimal(ordinal);
    public override double GetDouble(int ordinal) => inner.GetDouble(ordinal);
    public override Type GetFieldType(int ordinal) => inner.GetFieldType(ordinal);
    public override float GetFloat(int ordinal) => inner.GetFloat(ordinal);
    public override Guid GetGuid(int ordinal) => inner.GetGuid(ordinal);
    public override short GetInt16(int ordinal) => inner.GetInt16(ordinal);
    public override int GetInt32(int ordinal) => inner.GetInt32(ordinal);
    public override long GetInt64(int ordinal) => inner.GetInt64(ordinal);
    public override string GetName(int ordinal) => inner.GetName(ordinal);
    public override int GetOrdinal(string name) => inner.GetOrdinal(name);
    public override string GetString(int ordinal) => inner.GetString(ordinal);
    public override object GetValue(int ordinal) => inner.GetValue(ordinal);
    public override int GetValues(object[] values) => inner.GetValues(values);
    public override bool IsDBNull(int ordinal) => inner.IsDBNull(ordinal);
    public override IEnumerator GetEnumerator() => new CapturingEnumerator(((IEnumerable)inner).GetEnumerator(), this);
    public override DataTable? GetSchemaTable() => inner.GetSchemaTable();

    public override bool NextResult()
    {
        try
        {
            var hasNextResult = inner.NextResult();
            Finish(_readerCompleted);
            return hasNextResult;
        }
        catch (Exception exception) { capture.Fail(session, exception); throw; }
    }

    public override async Task<bool> NextResultAsync(CancellationToken cancellationToken)
    {
        try
        {
            var hasNextResult = await inner.NextResultAsync(cancellationToken);
            Finish(_readerCompleted);
            return hasNextResult;
        }
        catch (Exception exception) { capture.Fail(session, exception); throw; }
    }

    public override bool Read()
    {
        try
        {
            session.Results.CaptureSchema(inner);
            var hasRow = inner.Read();
            if (hasRow) session.Results.CaptureRow(inner);
            else Finish(true);
            return hasRow;
        }
        catch (Exception exception) { capture.Fail(session, exception); throw; }
    }

    public override async Task<bool> ReadAsync(CancellationToken cancellationToken)
    {
        try
        {
            session.Results.CaptureSchema(inner);
            var hasRow = await inner.ReadAsync(cancellationToken);
            if (hasRow) session.Results.CaptureRow(inner);
            else Finish(true);
            return hasRow;
        }
        catch (Exception exception) { capture.Fail(session, exception); throw; }
    }

    public override void Close()
    {
        inner.Close();
        Finish(_readerCompleted);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) inner.Dispose();
        Finish(_readerCompleted);
        base.Dispose(disposing);
    }

    private void Finish(bool readerCompleted)
    {
        _readerCompleted |= readerCompleted;
        capture.Complete(session, _readerCompleted);
    }

    private bool MoveEnumeratorNext(IEnumerator enumerator)
    {
        try
        {
            var hasRow = enumerator.MoveNext();
            if (hasRow) session.Results.CaptureRow(inner);
            else Finish(true);
            return hasRow;
        }
        catch (Exception exception) { capture.Fail(session, exception); throw; }
    }

    private sealed class CapturingEnumerator(IEnumerator innerEnumerator, HttpInspectorDbDataReader reader) : IEnumerator
    {
        public object Current => innerEnumerator.Current;
        public bool MoveNext() => reader.MoveEnumeratorNext(innerEnumerator);
        public void Reset() => innerEnumerator.Reset();
    }
}
