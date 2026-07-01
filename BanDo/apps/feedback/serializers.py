from rest_framework import serializers
from feedback.models import Feedback, Report
from accounts.serializers import UserSerializer

class FeedbackSerializer(serializers.ModelSerializer):
    user_info = UserSerializer(source='user', read_only=True)

    class Meta:
        model = Feedback
        fields = ('id', 'user', 'user_info', 'subject', 'message', 'rating', 'response', 'created_at')
        read_only_fields = ('id', 'user', 'response', 'created_at')

class ReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = Report
        fields = '__all__'
