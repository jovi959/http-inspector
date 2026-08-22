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
    public override object this[int ordinal] => Observe(ordinal, inner[ordinal]);
    public override object this[string name]
    {
        get
        {
            var ordinal = inner.GetOrdinal(name);
            return Observe(ordinal, inner[ordinal]);
        }
    }
    public override bool GetBoolean(int ordinal) => Observe(ordinal, inner.GetBoolean(ordinal));
    public override byte GetByte(int ordinal) => Observe(ordinal, inner.GetByte(ordinal));
    public override long GetBytes(int ordinal, long dataOffset, byte[]? buffer, int bufferOffset, int length) => inner.GetBytes(ordinal, dataOffset, buffer, bufferOffset, length);
    public override char GetChar(int ordinal) => Observe(ordinal, inner.GetChar(ordinal));
    public override long GetChars(int ordinal, long dataOffset, char[]? buffer, int bufferOffset, int length) => inner.GetChars(ordinal, dataOffset, buffer, bufferOffset, length);
    public override string GetDataTypeName(int ordinal) => inner.GetDataTypeName(ordinal);
    public override DateTime GetDateTime(int ordinal) => Observe(ordinal, inner.GetDateTime(ordinal));
    public override decimal GetDecimal(int ordinal) => Observe(ordinal, inner.GetDecimal(ordinal));
    public override double GetDouble(int ordinal) => Observe(ordinal, inner.GetDouble(ordinal));
    public override Type GetFieldType(int ordinal) => inner.GetFieldType(ordinal);
    public override float GetFloat(int ordinal) => Observe(ordinal, inner.GetFloat(ordinal));
    public override Guid GetGuid(int ordinal) => Observe(ordinal, inner.GetGuid(ordinal));
    public override short GetInt16(int ordinal) => Observe(ordinal, inner.GetInt16(ordinal));
    public override int GetInt32(int ordinal) => Observe(ordinal, inner.GetInt32(ordinal));
    public override long GetInt64(int ordinal) => Observe(ordinal, inner.GetInt64(ordinal));
    public override string GetName(int ordinal) => inner.GetName(ordinal);
    public override int GetOrdinal(string name) => inner.GetOrdinal(name);
    public override string GetString(int ordinal) => Observe(ordinal, inner.GetString(ordinal));
    public override object GetValue(int ordinal) => Observe(ordinal, inner.GetValue(ordinal));
    public override int GetValues(object[] values)
    {
        var count = inner.GetValues(values);
        for (var ordinal = 0; ordinal < count; ordinal++) session.Results.CaptureCell(ordinal, values[ordinal]);
        return count;
    }
    public override bool IsDBNull(int ordinal)
    {
        var isNull = inner.IsDBNull(ordinal);
        if (isNull) session.Results.CaptureCell(ordinal, null);
        return isNull;
    }
    public override T GetFieldValue<T>(int ordinal) => Observe(ordinal, inner.GetFieldValue<T>(ordinal));
    public override async Task<T> GetFieldValueAsync<T>(int ordinal, CancellationToken cancellationToken)
        => Observe(ordinal, await inner.GetFieldValueAsync<T>(ordinal, cancellationToken));
    public override async Task<bool> IsDBNullAsync(int ordinal, CancellationToken cancellationToken)
    {
        var isNull = await inner.IsDBNullAsync(ordinal, cancellationToken);
        if (isNull) session.Results.CaptureCell(ordinal, null);
        return isNull;
    }
    public override IEnumerator GetEnumerator() => new CapturingEnumerator(((IEnumerable)inner).GetEnumerator(), this);
    public override DataTable? GetSchemaTable() => inner.GetSchemaTable();

    public override bool NextResult()
    {
        try
        {
            session.Results.CompleteRow();
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
            session.Results.CompleteRow();
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
            session.Results.CompleteRow();
            session.Results.CaptureSchema(inner);
            var hasRow = inner.Read();
            if (hasRow) session.Results.BeginRow(inner);
            else Finish(true);
            return hasRow;
        }
        catch (Exception exception) { capture.Fail(session, exception); throw; }
    }

    public override async Task<bool> ReadAsync(CancellationToken cancellationToken)
    {
        try
        {
            session.Results.CompleteRow();
            session.Results.CaptureSchema(inner);
            var hasRow = await inner.ReadAsync(cancellationToken);
            if (hasRow) session.Results.BeginRow(inner);
            else Finish(true);
            return hasRow;
        }
        catch (Exception exception) { capture.Fail(session, exception); throw; }
    }

    public override void Close()
    {
        session.Results.CompleteRow();
        inner.Close();
        Finish(_readerCompleted);
    }

    protected override void Dispose(bool disposing)
    {
        session.Results.CompleteRow();
        if (disposing) inner.Dispose();
        Finish(_readerCompleted);
        base.Dispose(disposing);
    }

    private void Finish(bool readerCompleted)
    {
        _readerCompleted |= readerCompleted;
        capture.Complete(session, _readerCompleted);
    }

    private T Observe<T>(int ordinal, T value)
    {
        session.Results.CaptureCell(ordinal, value);
        return value;
    }

    private bool MoveEnumeratorNext(IEnumerator enumerator)
    {
        try
        {
            session.Results.CompleteRow();
            var hasRow = enumerator.MoveNext();
            if (hasRow) session.Results.BeginRow(inner);
            else Finish(true);
            return hasRow;
        }
        catch (Exception exception) { capture.Fail(session, exception); throw; }
    }

    private sealed class CapturingEnumerator(IEnumerator innerEnumerator, HttpInspectorDbDataReader reader) : IEnumerator
    {
        public object Current => reader;
        public bool MoveNext() => reader.MoveEnumeratorNext(innerEnumerator);
        public void Reset() => innerEnumerator.Reset();
    }
}
